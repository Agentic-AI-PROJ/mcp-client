import mongoose from "mongoose";

const mcpServerSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true }, // Unique identifier (e.g. "http:..." or "stdio:...")
    name: { type: String, required: false }, // Display name
    url: { type: String, required: false }, // For SSE/HTTP
    command: { type: String, required: false }, // For Stdio
    args: { type: [String], required: false }, // For Stdio
    env: { type: Map, of: String, required: false }, // For Stdio
    type: { type: String, required: true, enum: ["sse", "http", "stdio"] },
    logo: { type: String, required: false },
    isActive: { type: Boolean, default: true },
    addedAt: { type: Date, default: Date.now }
});

// Remove old index if it exists in DB (will need to drop collection or index manually if not dropping DB)
// mcpServerSchema.index({ url: 1, command: 1, args: 1 }, { unique: true });


const mcpToolSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    inputSchema: { type: Object },
    server: { type: mongoose.Schema.Types.ObjectId, ref: 'McpServer', required: true }, // Reference to McpServer
    isActive: { type: Boolean, default: true },
    addedAt: { type: Date, default: Date.now }
});

// Unique index on tool name + server as requested
mcpToolSchema.index({ name: 1, server: 1 }, { unique: true });


export const McpServer = mongoose.model("McpServer", mcpServerSchema);
export const McpTool = mongoose.model("McpTool", mcpToolSchema);
