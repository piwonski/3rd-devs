import { HeadquartersService } from '../shared/HeadquartersService';
import { OpenAIService } from '../shared/OpenAIService';
import { RequestService } from '../shared/RequestService';

const openAIService = new OpenAIService();

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);

async function main() {
    // Fetch users (ID and names)
    const users = await headquartersService.queryDb('database', 'SELECT * FROM users;');
    console.log('Users:', users);

    // Fetch connections (pairs of IDs)
    const connections = await headquartersService.queryDb('database', 'SELECT * FROM connections;');
    console.log('Connections:', connections);
}

await main();