import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ClientManager, ServerConfig } from "./manager";
import connectDB from "./db/connect";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3011;

// Middleware
// app.use(cors());
app.use(express.json());

const startServer = async () => {
    try {
        await connectDB();

        // Initialize ClientManager
        const manager = new ClientManager();

        // Load saved servers on startup
        manager.loadServers().catch(err => {
            console.error("Failed to load servers:", err);
        });

        // POST /servers - Register a new MCP server
        app.post("/servers", async (req: Request, res: Response) => {
            try {
                const config: ServerConfig = req.body;

                // Validate config
                if (!config.type) {
                    return res.status(400).json({ error: "Missing 'type' field" });
                }

                if ((config.type === "sse" || config.type === "http") && !config.url) {
                    return res.status(400).json({ error: "Missing 'url' field for SSE/HTTP server" });
                }

                if (config.type === "stdio" && (!config.command || !config.args)) {
                    return res.status(400).json({ error: "Missing 'command' or 'args' field for Stdio server" });
                }

                await manager.connect(config, true);

                res.json({
                    success: true,
                    message: "Server registered successfully"
                });
            } catch (error: any) {
                console.error("Error registering server:", error);
                res.status(500).json({
                    success: false,
                    error: error.message || "Failed to register server"
                });
            }
        });

        // DELETE /servers - Unregister a server
        app.delete("/servers", async (req: Request, res: Response) => {
            try {
                const { url, command, key } = req.body;
                const identifier = key || url || command;

                if (!identifier) {
                    return res.status(400).json({ error: "Missing 'key', 'url' or 'command' field" });
                }

                const removed = await manager.removeServer(identifier);

                if (removed) {
                    res.json({
                        success: true,
                        message: "Server unregistered successfully"
                    });
                } else {
                    res.status(404).json({
                        success: false,
                        error: "Server not found"
                    });
                }
            } catch (error: any) {
                console.error("Error unregistering server:", error);
                res.status(500).json({
                    success: false,
                    error: error.message || "Failed to unregister server"
                });
            }
        });

        // GET /servers - List all registered servers
        app.get("/servers", (req: Request, res: Response) => {
            try {
                const servers = manager.listServers();
                res.json({ servers });
            } catch (error: any) {
                console.error("Error listing servers:", error);
                res.status(500).json({
                    error: error.message || "Failed to list servers"
                });
            }
        });

        // GET /tools - List all available tools from all servers
        app.get("/tools", async (req: Request, res: Response) => {
            try {
                const toolsList = await manager.listTools();
                // toolsList is already formatted by manager.listTools() now
                res.json({ tools: toolsList });
            } catch (error: any) {
                console.error("Error listing tools:", error);
                res.status(500).json({
                    error: error.message || "Failed to list tools"
                });
            }
        });

        // POST /tools/:name - Execute a tool
        app.post("/tools/:name", async (req: Request, res: Response) => {
            try {
                const toolName = req.params.name;
                const args = req.body.arguments || {};

                const result = await manager.callTool(toolName, args);

                res.json({ result });
            } catch (error: any) {
                console.error("Error calling tool:", error);
                res.status(500).json({
                    error: error.message || "Failed to call tool"
                });
            }
        });

        // Health check endpoint
        app.get("/health", (req: Request, res: Response) => {
            res.json({ status: "RUNNING" });
        });

        // --- Admin Endpoints ---

        app.get("/admin/servers", async (req: Request, res: Response) => {
            try {
                const servers = await manager.listAllServers();
                res.json({ servers });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        app.get("/admin/tools", async (req: Request, res: Response) => {
            try {
                const tools = await manager.listAllTools();
                res.json({ tools });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        app.patch("/admin/servers/:key/status", async (req: Request, res: Response) => {
            try {
                const { isActive } = req.body;
                if (typeof isActive !== 'boolean') {
                    return res.status(400).json({ error: "isActive must be a boolean" });
                }
                // Key might need decoding if it contains special chars passed in URL?
                // Usually :key param captures segment. "sse:http://..." might be tricky if it contains slashes.
                // Clients should probably URL encode the key?
                // Actually express might split slashes.
                // If key is "http://localhost:3010", express might mistake /localhost... as further path.
                // We should expect the key to be passed in body OR encode it correctly.
                // But user requested `/admin/servers/:key/status`.
                // Better approach: Pass key in body or accept expected encoding.
                // Given the format "http:http://localhost...", it definitely contains slashes.
                // IMPORTANT: Express parameters *stop* at slash usually unless regex is used.
                // Using ` encodeURIComponent` on client side is standard. Express decodes `req.params`.
                // But wait, if URL is `.../status`, middleware might fail if `key` has slashes and is not encoded.
                // If encoded, `%2F` works.
                const key = decodeURIComponent(req.params.key);
                const updated = await manager.updateServerStatus(key, isActive);
                res.json({ success: true, server: updated });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        app.patch("/admin/tools/:id/status", async (req: Request, res: Response) => {
            try {
                const { isActive } = req.body;
                if (typeof isActive !== 'boolean') {
                    return res.status(400).json({ error: "isActive must be a boolean" });
                }
                const updated = await manager.updateToolStatus(req.params.id, isActive);
                res.json({ success: true, tool: updated });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        app.patch("/admin/servers/:key", async (req: Request, res: Response) => {
            try {
                const key = decodeURIComponent(req.params.key);
                const updates = req.body;
                // Basic validation could go here

                const updated = await manager.updateServer(key, updates);
                res.json({ success: true, server: updated });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });

        app.get("/admin/tools/:name/logo", async (req: Request, res: Response) => {
            try {
                const logo = await manager.getToolLogo(req.params.name);
                res.json({ logo });
            } catch (error: any) {
                res.status(500).json({ error: error.message });
            }
        });


        // Start server
        app.listen(PORT, () => {
            console.log(`MCP Client Server running on http://localhost:${PORT}`);
            console.log(`\nAvailable endpoints:`);
            console.log(`  POST   /servers       - Register a new MCP server`);
            console.log(`  DELETE /servers       - Unregister a server`);
            console.log(`  GET    /servers       - List all registered servers`);
            console.log(`  GET    /tools         - List all available tools`);
            console.log(`  POST   /tools/:name   - Execute a tool`);
            console.log(`  GET    /health        - Health check\n`);
        });

    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

startServer();
