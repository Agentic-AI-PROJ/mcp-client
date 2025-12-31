# MCP Client Service

The **MCP Client Service** acts as a centralized bridge that connects to multiple [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers. It aggregates tools and resources from these servers and exposes them via a unified HTTP API for the main application to use.

## 🚀 Features

- **Protocol Support**: Connects to MCP servers via **SSE** (Server-Sent Events), **HTTP**, and **Stdio**.
- **Unified Tool Registry**: Aggregates tools from all connected servers into a single list.
- **Dynamic Management**: Register, unregister, and manage server connections at runtime.
- **Persistence**: Saves server configurations and tool metadata to MongoDB.
- **Admin Interface**: Dedicated endpoints for managing server/tool status (active/inactive).
- **CLI Utility**: Built-in command-line interface for testing connections and tools directly.

## 🛠️ Technology Stack

- **Runtime**: Node.js, Express
- **SDK**: @modelcontextprotocol/sdk
- **Database**: MongoDB (via Mongoose)
- **CLI**: Readline, Eventsource (polyfill)

## 📦 Installation & Setup

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Environment Variables**:
    Create a `.env` file in the root of the service:
    ```env
    PORT=3011
    MONGO_URI=mongodb://localhost:27017/ai-agents
    ```

3.  **Run Service**:
    *   **API Server Mode** (for general use):
        ```bash
        npm run server
        ```
        Runs at `http://localhost:3011`.

    *   **CLI Mode** (for interactive testing):
        ```bash
        npm start
        ```

## 🔌 API Reference & Curl Examples

### 1. Server Management

#### Register a Server
Connect to a new MCP server (e.g., a local SSE server or stdio command).

```bash
# Register an SSE Server
curl -X POST http://localhost:3011/servers \
  -H "Content-Type: application/json" \
  -d '{
    "type": "sse",
    "url": "http://localhost:3001/sse"
  }'

# Register a Stdio Server
curl -X POST http://localhost:3011/servers \
  -H "Content-Type: application/json" \
  -d '{
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/files"]
  }'
```

#### List Connected Servers
```bash
curl http://localhost:3011/servers
```

#### Unregister a Server
```bash
curl -X DELETE http://localhost:3011/servers \
  -H "Content-Type: application/json" \
  -d '{ "url": "http://localhost:3001/sse" }'
```

### 2. Tool Interaction

#### List All Tools
Get a combined list of tools from all connected servers.
```bash
curl http://localhost:3011/tools
```

#### Call a Tool
Execute a tool by name. The service routes the request to the appropriate MCP server.
```bash
curl -X POST http://localhost:3011/tools/read_file \
  -H "Content-Type: application/json" \
  -d '{
    "arguments": {
      "path": "/Users/me/files/test.txt"
    }
  }'
```

### 3. Admin Endpoints

#### List All Servers (Database View)
```bash
curl http://localhost:3011/admin/servers
```

#### Toggle Server Status
Enable or disable a server (and its tools).
```bash
# Note: Key handles special chars, usually URL encoded
curl -X PATCH http://localhost:3011/admin/servers/sse%3Ahttp%3A%2F%2Flocalhost%3A3001%2Fsse/status \
  -H "Content-Type: application/json" \
  -d '{ "isActive": false }'
```

## 💓 Health Checks

- **Server Status**: `GET /health`
