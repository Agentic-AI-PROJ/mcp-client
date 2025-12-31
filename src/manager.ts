import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { EventSource } from "eventsource";
import { McpServer, McpTool } from "./db/models";

// Polyfill EventSource for Node.js
global.EventSource = EventSource as any;

export type ServerConfig =
    | { type: "sse"; url: string; headers?: Record<string, string> }
    | { type: "http"; url: string; headers?: Record<string, string> }
    | { type: "stdio"; command: string; args: string[]; env?: Record<string, string> };

export interface ConnectedClient {
    client: Client;
    transport: Transport;
    config: ServerConfig;
    tools: any[];
}

export class ClientManager {
    private clients: Map<string, ConnectedClient> = new Map();

    constructor(private authHandler?: (url: string) => Promise<string | null>) { }

    private getConfigKey(config: ServerConfig): string {
        if (config.type === "sse") return `sse:${config.url}`;
        if (config.type === "http") return `http:${config.url}`;
        if (config.type === "stdio") return `stdio:${config.command} ${config.args.join(" ")}`;
        return "unknown";
    }

    async connect(config: ServerConfig, save: boolean = false) {
        const key = this.getConfigKey(config);
        if (this.clients.has(key)) {
            console.log(`Already connected to ${key}`);
            return;
        }

        console.log(`Connecting to ${key}...`);
        try {
            let transport: Transport;
            if (config.type === "sse") {
                transport = new SSEClientTransport(new URL(config.url), {
                    eventSourceInit: {
                        headers: config.headers,
                    } as any
                });
            } else if (config.type === "http") {
                transport = new StreamableHTTPClientTransport(new URL(config.url), {
                    requestInit: {
                        headers: config.headers,
                    }
                });
            } else {
                transport = new StdioClientTransport({
                    command: config.command,
                    args: config.args,
                    env: config.env ? { ...process.env as Record<string, string>, ...config.env } : undefined,
                });
            }

            const client = new Client(
                {
                    name: "mcp-client",
                    version: "1.0.0",
                },
                {
                    capabilities: {},
                }
            );

            await client.connect(transport);
            const toolsResult = await client.listTools();

            this.clients.set(key, {
                client,
                transport,
                config,
                tools: toolsResult.tools,
            });

            console.log(`Connected to ${key}`);

            if (save) {
                await this.saveServer(config);
            }

            // Sync tools with MongoDB
            await this.syncTools(key, toolsResult.tools);

        } catch (error: any) {
            console.error(`Failed to connect to ${key}:`, error.message || error);
            if ((config.type === "sse" || config.type === "http") && (error?.code === 401 || error?.code === 403 || error?.message?.includes("401") || error?.message?.includes("403") || error?.message?.includes("Unauthorized"))) {
                if (this.authHandler) {
                    console.log("Authentication required.");
                    const token = await this.authHandler(config.url);
                    if (token) {
                        const newConfig = {
                            ...config,
                            headers: { ...config.headers, "Authorization": `Bearer ${token}` }
                        };
                        // Retry connection with new token
                        await this.connect(newConfig, save);
                    }
                } else {
                    throw new Error("Authentication required");
                }
            } else {
                throw error;
            }
        }
    }

    private async syncTools(serverKey: string, currentTools: any[]) {
        try {
            // Find the server document to get its ID
            const serverDoc = await McpServer.findOne({ key: serverKey });
            if (!serverDoc) {
                console.error(`Resulting server doc not found for key ${serverKey} during tool sync`);
                return;
            }

            // Get existing tools for this server from MongoDB using ObjectId
            const existingTools = await McpTool.find({ server: serverDoc._id });
            const existingToolNames = new Set(existingTools.map(t => t.name));
            const currentToolNames = new Set(currentTools.map((t: any) => t.name));

            // Tools to add
            const toolsToAdd = currentTools.filter((t: any) => !existingToolNames.has(t.name));
            for (const tool of toolsToAdd) {
                await McpTool.create({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    server: serverDoc._id,
                    isActive: true
                });
                console.log(`Added tool ${tool.name} to MongoDB`);
            }

            // Tools to delete
            const toolsToDelete = existingTools.filter(t => !currentToolNames.has(t.name));
            for (const tool of toolsToDelete) {
                await McpTool.deleteOne({ _id: tool._id });
                console.log(`Deleted tool ${tool.name} from MongoDB`);
            }

        } catch (error) {
            console.error("Error syncing tools:", error);
        }
    }

    private async saveServer(config: ServerConfig) {
        try {
            const key = this.getConfigKey(config);
            const filter = { key };

            const existing = await McpServer.findOne(filter);
            if (!existing) {
                await McpServer.create({ ...config, key });
                console.log(`Saved server to MongoDB`);
            } else {
                // Update if exists (e.g. headers changed)
                await McpServer.updateOne(filter, { ...config, key });
                console.log(`Updated server in MongoDB`);
            }
        } catch (e) {
            console.error("Error saving server to MongoDB", e);
        }
    }

    async removeServer(urlOrCommand: string): Promise<boolean> {
        try {
            // Find server(s) to remove
            const serversToRemove = await McpServer.find({
                $or: [
                    { url: urlOrCommand },
                    { command: urlOrCommand },
                    { key: urlOrCommand }
                ]
            });

            if (serversToRemove.length === 0) {
                console.log(`Server ${urlOrCommand} not found in MongoDB`);
                return false;
            }

            for (const server of serversToRemove) {
                // Delete server
                await McpServer.deleteOne({ _id: server._id });
                console.log(`Removed ${server.key} from MongoDB`);

                // Delete associated tools
                await McpTool.deleteMany({ server: server._id });

                // Disconnect in-memory
                const key = server.key;
                if (this.clients.has(key)) {
                    this.clients.delete(key);
                }
            }

            return true;
        } catch (e) {
            console.error("Error removing server from MongoDB", e);
            return false;
        }
    }

    async loadServers() {
        try {
            const servers = await McpServer.find({ isActive: true });
            for (const doc of servers) {
                const config = doc.toObject() as any;
                delete config._id;
                delete config.__v;
                delete config.isActive;
                delete config.addedAt;

                await this.connect(config as ServerConfig);
            }
        } catch (e) {
            console.error("Error loading servers from MongoDB", e);
        }
    }

    listServers() {
        const servers: Array<{ key: string; config: ServerConfig; connected: boolean }> = [];
        for (const [key, client] of this.clients.entries()) {
            servers.push({
                key,
                config: client.config,
                connected: true
            });
        }
        return servers;
    }

    async listTools() {
        try {
            const tools = await McpTool.find({ isActive: true }).populate('server');
            return tools.map((t: any) => ({
                name: t.name,
                description: t.description || "No description",
                inputSchema: t.inputSchema || {},
                server: t.server ? t.server.key : "unknown"
            }));
        } catch (error) {
            console.error("Error listing tools from MongoDB:", error);
            return [];
        }
    }

    async callTool(toolName: string, args: any) {
        // Find client with this tool
        let targetClient: ConnectedClient | undefined;

        for (const client of this.clients.values()) {
            if (client.tools.find((t) => t.name === toolName)) {
                targetClient = client;
                break;
            }
        }

        if (!targetClient) {
            throw new Error(`Tool ${toolName} not found on any connected server.`);
        }

        return await targetClient.client.callTool({
            name: toolName,
            arguments: args,
        });
    }

    getToolDetails(toolName: string) {
        for (const client of this.clients.values()) {
            const tool = client.tools.find((t: any) => t.name === toolName);
            if (tool) return tool;
        }
        return null;
    }

    // --- Admin Methods ---

    async listAllServers() {
        try {
            return await McpServer.find({});
        } catch (error) {
            console.error("Error listing all servers:", error);
            return [];
        }
    }

    async listAllTools() {
        try {
            const tools = await McpTool.find({}).populate('server');
            return tools.map((t: any) => ({
                id: t._id,
                name: t.name,
                description: t.description || "No description",
                inputSchema: t.inputSchema || {},
                server: t.server ? t.server.key : "unknown",
                server_id: t.server ? t.server._id : null,
                isActive: t.isActive
            }));
        } catch (error) {
            console.error("Error listing all tools:", error);
            return [];
        }
    }

    async updateServerStatus(key: string, isActive: boolean) {
        try {
            const server = await McpServer.findOne({ key });
            if (!server) {
                throw new Error(`Server ${key} not found`);
            }

            server.isActive = isActive;
            await server.save();

            if (!isActive) {
                // If deactivating server, also deactivate all its tools
                await McpTool.updateMany({ server: server._id }, { isActive: false });

                // Disconnect if currently connected
                if (this.clients.has(key)) {
                    this.clients.delete(key);
                    console.log(`Disconnected ${key} due to deactivation`);
                }
            } else {
                // If activating server, attempt to connect
                // Note: We don't automatically activate tools, user can do that manually if needed, 
                // or we can assume they stay as they were (if they were active)
                // However, the connected client will fetch tools and sync them.
                // Our sync logic currently adds tools as active.
                // So if we connect, syncTools will run.
                try {
                    const config = server.toObject() as any;
                    delete config._id;
                    delete config.__v;
                    delete config.isActive;
                    delete config.addedAt;
                    await this.connect(config as ServerConfig);
                } catch (e) {
                    console.error(`Failed to reconnect activated server ${key}:`, e);
                }
            }
            return server;
        } catch (error) {
            console.error(`Error updating server status for ${key}:`, error);
            throw error;
        }
    }

    async updateToolStatus(id: string, isActive: boolean) {
        try {
            const tool = await McpTool.findById(id);
            if (!tool) {
                throw new Error(`Tool ${id} not found`);
            }

            tool.isActive = isActive;
            await tool.save();
            return tool;
        } catch (error) {
            console.error(`Error updating tool status for ${id}:`, error);
            throw error;
        }
    }

    async updateServer(key: string, updates: Partial<any>) {
        try {
            const server = await McpServer.findOne({ key });
            if (!server) {
                throw new Error(`Server ${key} not found`);
            }

            // Allow updating logo or other non-critical fields
            if (updates.logo !== undefined) server.logo = updates.logo;

            // Handle active status if passed (though status endpoint prefers updateServerStatus)
            if (updates.isActive !== undefined) {
                // For now, delegate strictly status logic to updateServerStatus or handle here?
                // Let's stick to updateServerStatus for status logic to keep side-effects (connection/disconnection) centralized.
                // This method handles "metadata".
            }

            await server.save();
            return server;
        } catch (error) {
            console.error(`Error updating server details for ${key}:`, error);
            throw error;
        }
    }

    async getToolLogo(toolName: string): Promise<string | undefined> {
        try {
            const tool = await McpTool.findOne({ name: toolName }).populate<{ server: any }>('server');
            if (!tool || !tool.server) return undefined;
            return tool.server.logo;
        } catch (error) {
            console.error(`Error fetching logo for tool ${toolName}:`, error);
            return undefined;
        }
    }
}
