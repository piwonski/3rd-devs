import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { heartRoute } from './routes';

async function main() {
    try {
        const requestService = new RequestService();
        const headquartersService = new HeadquartersService(requestService);
        
        const host = process.env.NGROK_HOST;
        
        // Construct the server URL
        const serverUrl = `${host}${heartRoute}`;
        console.log('Reporting server URL to headquarters:', serverUrl);
        
        console.log('Server URL:', serverUrl);

        // Report the server URL to headquarters
        const response = await headquartersService.report('serce', serverUrl);
        console.log('Headquarters response:', response);
        
    } catch (error) {
        console.error('Error reporting to headquarters:', error);
    }
}

await main();