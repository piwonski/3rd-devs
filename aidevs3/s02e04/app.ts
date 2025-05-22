import fs from "fs";
import path from "path";
import {HeadquartersService} from "../shared/HeadquartersService.ts";
import {RequestService} from "../shared/RequestService.ts";

const inputDirectoryName = 'input-files';

interface FactoryAnswer {
    people: string[];
    hardware: string[];
}

const requestService = new RequestService();
const headquartersService = new HeadquartersService(requestService);

function prepareFactoryAnswer(): FactoryAnswer {
    return {
        people: [],
        hardware: [],
    }
}

async function main() {
    const mapFiles = fs.readdirSync(path.join(__dirname, inputDirectoryName))
        .map(file => path.join(__dirname, inputDirectoryName, file));
    console.log('Map files:', mapFiles);

    const answer: FactoryAnswer = prepareFactoryAnswer();

    const headquartersResponse = await headquartersService.report('kategorie', answer);
    console.log('Headquarters response:', headquartersResponse);
}

await main();