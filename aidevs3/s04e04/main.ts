import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';
import { startFlightRoute } from './routes';

async function main() {
    try {
        const requestService = new RequestService();
        const headquartersService = new HeadquartersService(requestService);
        
        const host = process.env.AZYL_HOST;
        
        // Construct the server URL
        const serverUrl = `${host}${startFlightRoute}`;
        console.log('Reporting server URL to headquarters:', serverUrl);
        
        console.log('Server URL:', serverUrl);

        // Report the server URL to headquarters
        const response = await headquartersService.report('webhook', serverUrl);
        console.log('Headquarters response:', response);
        
    } catch (error) {
        console.error('Error reporting to headquarters:', error);
    }
}

await main();