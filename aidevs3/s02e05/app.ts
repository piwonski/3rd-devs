import { Environment } from '../shared/Environment';
import { HeadquartersService } from '../shared/HeadquartersService';
import { RequestService } from '../shared/RequestService';

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);

async function main() {
    
    // Fetch the article
    const article = await headquartersService.getArxivHtml();
    
    // Fetch the questions
    const questions = await headquartersService.getArxivQuestions();
    console.log('Questions:', questions);
}

await main();