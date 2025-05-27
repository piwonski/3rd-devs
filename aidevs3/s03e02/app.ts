import * as path from 'path';
import { DownloadService } from '../shared/DownloadService';
import { UnzipService } from '../shared/UnzipService';
import { Environment } from '../shared/Environment';
import { OpenAIService } from '../shared/OpenAIService';
import { VectorService } from '../shared/VectorService';
import { TextSplitter } from '../shared/TextSplitter';

const cacheDir = path.join(__dirname, 'cache');
const downloadService = new DownloadService(cacheDir);
const unzipService = new UnzipService(cacheDir);
const openAIService = new OpenAIService();
const vectorService = new VectorService(openAIService);
const textSplitter = new TextSplitter();

async function main() {
    const zipUrl = `${Environment.getHeadquartersHost()}/dane/pliki_z_fabryki.zip`;
    const zipFileName = 'pliki_z_fabryki.zip';

    await downloadService.downloadFile(zipUrl, zipFileName);
    await unzipService.unzipFile(zipFileName, Environment.getFilesFromFactoryZipPassword());

    await vectorService.ensureCollection('factory_data');
}

await main();