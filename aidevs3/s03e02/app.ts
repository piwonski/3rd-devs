import * as path from 'path';
import { DownloadService } from '../shared/DownloadService';
import { UnzipService } from '../shared/UnzipService';
import { Environment } from '../shared/Environment';
import { OpenAIService } from '../shared/OpenAIService';
import { VectorService } from '../shared/VectorService';
import { TextSplitter } from '../shared/TextSplitter';
import { CacheService } from '../shared/CacheService';

const cacheDir = path.join(__dirname, 'cache');
const downloadService = new DownloadService(cacheDir);
const unzipService = new UnzipService(cacheDir);
const cacheService = new CacheService(cacheDir);

const openAIService = new OpenAIService();
const vectorService = new VectorService(openAIService);
const textSplitter = new TextSplitter();

async function main() {
    const password = Environment.getFilesFromFactoryZipPassword();
    if (!await cacheService.fileExists('pliki_z_fabryki.zip')) {
        const zipUrl = `${Environment.getHeadquartersHost()}/dane/pliki_z_fabryki.zip`;
        const zipFileName = 'pliki_z_fabryki.zip';

        await downloadService.downloadFile(zipUrl, zipFileName);
        await unzipService.unzipFile({ zipPaths: [zipFileName], password });
    }
    
    if (!await cacheService.fileExists('weapons_tests', 'do-not-share')) {
        await unzipService.unzipFile({ zipPaths: ['pliki_z_fabryki', 'weapons_tests.zip'], password });
    }

    await vectorService.ensureCollection('factory_data');
}

await main();