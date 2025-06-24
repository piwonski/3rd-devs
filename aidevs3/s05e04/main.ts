import { Environment } from '../shared/Environment';
import { RequestService } from '../shared/RequestService';
import type { HeadquartersResponse } from '../shared/sharedTypes';
import { heartRoute } from './routes';

async function main() {
    try {
        const requestService = new RequestService();
        
        const host = process.env.NGROK_HOST;
        
        // Construct the server URL
        const serverUrl = `${host}${heartRoute}`;
        console.log('Reporting server URL to headquarters:', serverUrl);
        
        console.log('Server URL:', serverUrl);

        // Report the server URL to headquarters
        const response: HeadquartersResponse = await requestService.post(`${Environment.getHeadquartersHost()}/report`, { 
            task: "serce", apikey: Environment.getCentralaApiKey(), answer: serverUrl, justUpdate: true 
        });
        console.log('Headquarters response:', response);
        
    } catch (error) {
        console.error('Error reporting to headquarters:', error);
    }
}

await main();