import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "./db/connect";
import { McpServer, McpTool } from "./db/models";

dotenv.config();

const servers = [
    {
        "type": "sse",
        "url": "http://localhost:3010/sse"
    },
    {
        "type": "stdio",
        "command": "docker",
        "args": [
            "run",
            "-i",
            "--rm",
            "--init",
            "web-search-mcp"
        ]
    },
    {
        "type": "stdio",
        "command": "docker",
        "args": [
            "run",
            "-i",
            "--rm",
            "--platform",
            "linux/amd64",
            "-e",
            "EMAIL_ADDRESS",
            "-e",
            "IMAP_HOST",
            "-e",
            "IMAP_PORT",
            "-e",
            "SMTP_HOST",
            "-e",
            "SMTP_PORT",
            "-e",
            "EMAIL_PASSWORD",
            "yashtekwani/gmail-mcp"
        ],
        "env": {
            "EMAIL_ADDRESS": "faizankhanm062002@gmail.com",
            "IMAP_HOST": "imap.gmail.com",
            "IMAP_PORT": "993",
            "SMTP_HOST": "smtp.gmail.com",
            "SMTP_PORT": "587",
            "EMAIL_PASSWORD": "itym kumn cbii rroo"
        }
    }
];

const seed = async () => {
    try {
        await connectDB();

        console.log("Clearing existing servers...");
        await McpServer.deleteMany({});
        console.log("Clearing existing tools...");
        await McpTool.deleteMany({});

        // We also need to drop the index if it exists, or just dropping the collection is safer
        // but deleteMany is fine if we updated the schema and the app handles index build?
        // Actually, if the old index exists, it might conflict.
        // Let's try to drop the specific index if we can via raw collection access or just hope mongoose syncs?
        // Mongoose syncIndexes() is a thing.
        console.log("Syncing indexes...");
        await McpServer.syncIndexes();

        console.log("Adding servers to MongoDB...");

        for (const config of servers) {
            let key = "";
            if (config.type === "sse") key = `sse:${config.url}`;
            else if (config.type === "http") key = `http:${config.url}`;
            else if (config.type === "stdio") key = `stdio:${config.command} ${(config.args || []).join(" ")}`;

            const existing = await McpServer.findOne({ key });
            if (!existing) {
                await McpServer.create({ ...config, key });
                console.log(`Added server: ${key}`);
            } else {
                console.log(`Server already exists: ${key}`);
            }
        }

        console.log("Seeding complete.");
        process.exit(0);
    } catch (error) {
        console.error("Seeding failed:", error);
        process.exit(1);
    }
};

seed();
