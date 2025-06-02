import path from 'path';
import { CacheService } from '../shared/CacheService';
import { HeadquartersService } from '../shared/HeadquartersService';
import { Neo4jService } from '../shared/Neo4jService';
import { OpenAIService } from '../shared/OpenAIService';
import { RequestService } from '../shared/RequestService';

interface User {
    id: number;
    username: string;
}

interface Connection {
    user1_id: number;
    user2_id: number;
}

const cacheDir = path.join(__dirname, 'cache');
const openAIService = new OpenAIService();
const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);
const cacheService = new CacheService(cacheDir);

await cacheService.ensureCacheDirectory();

// Initialize Neo4jService with proper credentials
const neo4jService = new Neo4jService(openAIService);

async function getUsers() {
    // Fetch users (ID and names) with caching
    const usersJson = await cacheService.getOrFetch('users.json', async () => {
        const usersResponse = await headquartersService.queryDb('database', 'SELECT * FROM users;');
        console.log('Users response:', usersResponse);

        if (usersResponse.error !== "OK") {
            console.error('Error fetching users:', usersResponse.error);
            throw new Error(usersResponse.error);
        }

        return JSON.stringify(usersResponse.reply);
    });

    return JSON.parse(usersJson) as User[];
}

async function getConnections() {
    // Fetch connections (pairs of IDs) with caching
    const connectionsJson = await cacheService.getOrFetch('connections.json', async () => {
        const connectionsResponse = await headquartersService.queryDb('database', 'SELECT * FROM connections;');
        console.log('Connections response:', connectionsResponse);

        if (connectionsResponse.error !== "OK") {
            console.error('Error fetching connections:', connectionsResponse.error);
            throw new Error(connectionsResponse.error);
        }

        return JSON.stringify(connectionsResponse.reply);
    });

    return JSON.parse(connectionsJson) as Connection[];
}

async function createGraphNodes(users: User[]): Promise<Map<number, { id: number, properties: Record<string, any> }>> {
    const userIdToNeo4jNode = new Map<number, { id: number, properties: Record<string, any> }>();
    
    // Create nodes for each user in Neo4j
    for (const user of users) {
        const node = await neo4jService.addNode('User', {
            userId: user.id,
            username: user.username
        });
        userIdToNeo4jNode.set(user.id, node);
        console.log(`Created user node:`, node);
    }

    return userIdToNeo4jNode;
}

async function createGraphConnections(
    connections: Connection[],
    userIdToNeo4jNode: Map<number, { id: number, properties: Record<string, any> }>
): Promise<void> {
    // Create KNOWS relationships between users using Neo4j IDs
    for (const connection of connections) {
        try {
            const fromNode = userIdToNeo4jNode.get(connection.user1_id);
            const toNode = userIdToNeo4jNode.get(connection.user2_id);

            if (!fromNode || !toNode) {
                console.error(`Could not find Neo4j nodes for users ${connection.user1_id} and/or ${connection.user2_id}`);
                continue;
            }

            await neo4jService.connectNodes(
                fromNode.id,
                toNode.id,
                'KNOWS'
            );
            console.log(`Created KNOWS relationship from user ${connection.user1_id} (${fromNode.properties.username}) to user ${connection.user2_id} (${toNode.properties.username})`);
        } catch (error) {
            console.error(`Error creating relationship between users ${connection.user1_id} and ${connection.user2_id}:`, error);
        }
    }
}

async function initializeNeo4j() {
    await neo4jService.createVectorIndex( "user_index", "User", "embedding", 3072 );
    await neo4jService.waitForIndexToBeOnline("user_index");

    const existingRecords = await neo4jService.executeQuery(`
        MATCH (u:User)
        RETURN count(u) AS count
    `);

    if (existingRecords.records[0].get("count").toNumber() > 0) {
        console.log("Records already exist. Skipping initialization.");
        return;
    }

    const users = await getUsers();
    console.log('Users:', users);

    const userIdToNeo4jNode = await createGraphNodes(users);

    const connections = await getConnections();
    console.log('Connections:', connections);

    await createGraphConnections(connections, userIdToNeo4jNode);
}

async function main() {
    try {
        await initializeNeo4j();
    } finally {
        await neo4jService.close();
    }
}

await main();