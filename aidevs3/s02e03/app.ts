import {OpenAIService} from "../shared/OpenAIService.ts";
import {HeadquartersService} from "../shared/HeadquartersService.ts";
import {RequestService} from "../shared/RequestService.ts";
import fetch from "node-fetch";
import {mkdir, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {dirname} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const openAIService = new OpenAIService();
const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);

const prompt = `
    Create a detailed image of a robot with the following description:
    {{robotDescription}}

    The image should be realistic.
    Don't add any text to the image.
`;

async function downloadImage(url: string, outputPath: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download image: ${response.statusText}`);
    
    const buffer = await response.buffer();
    await writeFile(outputPath, buffer);
    console.log("Image downloaded successfully!");
    return outputPath;
}

async function prepareLocalOutputPath() {
    // Create output directory if it doesn't exist
    const outputDir = `${__dirname}/output-images`;
    if (!existsSync(outputDir)) {
        await mkdir(outputDir, {recursive: true});
    }

    // Download the image with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${outputDir}/robot_image_${timestamp}.jpg`;
}

async function main() {
    const robotDescription = await headquartersService.getRobotDescription();
    console.log("Robot Description:", robotDescription);

    const imageUrl = await openAIService.generateImage(prompt.replace("{{robotDescription}}", robotDescription));
    console.log("Generated Image URL:", imageUrl);

    const localPath = await prepareLocalOutputPath();
    await downloadImage(imageUrl, localPath);
}

await main();