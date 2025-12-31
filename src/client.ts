import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { EventSource } from "eventsource";
import readline from "readline";
import path from "path";
import dotenv from "dotenv";
import connectDB from "./db/connect";

dotenv.config();
// connectDB called in main

// Polyfill EventSource for Node.js
global.EventSource = EventSource as any;

import { ClientManager } from "./manager";

// ClientManager class logic is now imported from manager.ts


const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

async function main() {
    await connectDB();

    const manager = new ClientManager(async (url) => {
        return new Promise((resolve) => {
            rl.question(`Authentication required for ${url}.\nEnter Bearer token (or press Enter to cancel): `, (token) => {
                resolve(token.trim() || null);
            });
        });
    });

    // Load saved servers
    await manager.loadServers();


    // Also connect to arg if provided
    if (process.argv[2]) {
        if (process.argv[2].startsWith("http")) {
            // Default to http transport for args
            await manager.connect({ type: "http", url: process.argv[2] });
        } else {
            // Assume stdio if not http, but parsing args is tricky here without flags.
            // For simplicity, let's treat argv[2] as command and rest as args
            const [command, ...args] = process.argv.slice(2);
            await manager.connect({ type: "stdio", command, args });
        }
    }

    const loop = () => {
        rl.question("\n> ", async (input) => {
            // Handle quoted arguments for stdio commands? 
            // For simple CLI, let's just split by space for now.
            // A better approach would be proper arg parsing.
            const parts = input.trim().match(/(?:[^\s"]+|"[^"]*")+/g) || [];
            const command = parts[0];
            const args = parts.slice(1).map(arg => arg.replace(/"/g, ''));

            if (command === "exit") {
                rl.close();
                process.exit(0);
            } else if (command === "register") {
                if (args.length > 0) {
                    const isSse = args.includes("--sse");
                    const cleanArgs = args.filter(a => a !== "--sse");

                    if (cleanArgs[0].startsWith("http")) {
                        const type = isSse ? "sse" : "http";
                        await manager.connect({ type, url: cleanArgs[0] }, true);
                    } else {
                        const [cmd, ...cmdArgs] = cleanArgs;
                        await manager.connect({ type: "stdio", command: cmd, args: cmdArgs }, true);
                    }
                } else {
                    console.log("Usage: register <url> [--sse] OR register <command> [args...]");
                }
            } else if (command === "auth") {
                if (args.length >= 2) {
                    const isSse = args.includes("--sse");
                    let headerName = "Authorization";
                    const headerFlagIndex = args.indexOf("--header");
                    if (headerFlagIndex !== -1 && headerFlagIndex + 1 < args.length) {
                        headerName = args[headerFlagIndex + 1];
                    }

                    const cleanArgs = args.filter((a, i) => a !== "--sse" && a !== "--header" && i !== headerFlagIndex + 1);

                    if (cleanArgs.length >= 2) {
                        const url = cleanArgs[0];
                        const token = cleanArgs[1];
                        const type = isSse ? "sse" : "http";
                        const headers: Record<string, string> = {};
                        if (headerName === "Authorization") {
                            headers[headerName] = `Bearer ${token}`;
                        } else {
                            headers[headerName] = token;
                        }

                        await manager.connect({
                            type: type,
                            url: url,
                            headers: headers
                        }, true);
                    } else {
                        console.log("Usage: auth <url> <token> [--sse] [--header <name>]");
                    }
                } else {
                    console.log("Usage: auth <url> <token> [--sse] [--header <name>]");
                }
            } else if (command === "unregister") {
                if (args.length > 0) {
                    await manager.removeServer(args[0]);
                } else {
                    console.log("Usage: unregister <url>");
                }
            } else if (command === "list") {
                const tools = await manager.listTools();
                if (tools.length === 0) {
                    console.log("No tools available. Use 'register' to connect to a server.");
                } else {
                    console.log("\nAvailable Tools:");
                    tools.forEach((tool: any) => {
                        console.log(`- ${tool.name} (${tool.server}): ${tool.description || "No description"}`);
                    });
                }
            } else if (command === "call") {
                const toolName = args[0];
                if (!toolName) {
                    console.log("Usage: call <tool_name>");
                    loop();
                    return;
                }

                const tool = manager.getToolDetails(toolName);
                if (!tool) {
                    console.log("Tool not found.");
                    loop();
                    return;
                }

                const toolArgs: Record<string, any> = {};
                if (tool.inputSchema && tool.inputSchema.properties) {
                    console.log("Enter arguments:");
                    for (const [argName, schema] of Object.entries(tool.inputSchema.properties)) {
                        await new Promise<void>((resolve) => {
                            rl.question(`  ${argName}: `, (value) => {
                                toolArgs[argName] = value;
                                resolve();
                            });
                        });
                    }
                }

                try {
                    const result = await manager.callTool(toolName, toolArgs);
                    console.log("\nResult:");
                    console.log(JSON.stringify(result, null, 2));
                } catch (error) {
                    console.error("Error calling tool:", error);
                }
            } else if (command === "help") {
                console.log("Commands:");
                console.log("  register <url> [--sse]      - Connect to an MCP server (defaults to HTTP, use --sse for SSE)");
                console.log("  register <cmd> [args...]    - Connect to a Stdio MCP server");
                console.log("  unregister <url>            - Remove a saved server");
                console.log("  auth <url> <token> [--sse] [--header <name>] - Connect with token (defaults to Authorization: Bearer, use --header for custom)");
                console.log("  list                        - List available tools from all servers");
                console.log("  call <tool>                 - Call a tool");
                console.log("  exit                        - Exit the client");
            } else {
                console.log("Unknown command. Type 'help' for available commands.");
            }

            loop();
        });
    };

    console.log("MCP Client Started. Type 'help' for commands.");
    loop();
}

main();
