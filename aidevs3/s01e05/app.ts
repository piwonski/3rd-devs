import { HeadquartersService } from "../shared/HeadquartersService.ts";
import { RequestService } from "../shared/RequestService.ts";

const headquartersService = new HeadquartersService(new RequestService());

async function main() {
    const uncensoredFile = await headquartersService.getUncensoredFile();
    console.log(uncensoredFile);
}

await main();
