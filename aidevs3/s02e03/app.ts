import {OpenAIService} from "../shared/OpenAIService.ts";
import {ExpenseCounter} from "../shared/ExpenseCounter.ts";
import {HeadquartersService} from "../shared/HeadquartersService.ts";
import { RequestService } from "../shared/RequestService.ts";

const openAIService = new OpenAIService();
const expenseCounter = new ExpenseCounter();
const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);

const prompt = `
    Create a detailed image of a robot with the following description:
    {{robotDescription}}

    The image should be realistic.
    Don't add any text to the image.
`;

async function main() {
    const robotDescription = await headquartersService.getRobotDescription();
    console.log("Robot Description:", robotDescription);

    const imageUrl = await openAIService.generateImage(prompt.replace("{{robotDescription}}", robotDescription));
    console.log("Generated Image URL:", imageUrl);
}

await main();