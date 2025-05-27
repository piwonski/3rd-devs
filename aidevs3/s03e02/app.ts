import * as path from 'path';
import { DownloadService } from '../shared/DownloadService';
import { UnzipService } from '../shared/UnzipService';
import { Environment } from '../shared/Environment';

const cacheDir = path.join(__dirname, 'cache');
const downloadService = new DownloadService(cacheDir);
const unzipService = new UnzipService(cacheDir);

async function main() {
    const zipUrl = `${Environment.getHeadquartersHost()}/dane/pliki_z_fabryki.zip`;
    const zipFileName = 'pliki_z_fabryki.zip';

    await downloadService.downloadFile(zipUrl, zipFileName);
    await unzipService.unzipFile(zipFileName, Environment.getFilesFromFactoryZipPassword());
}

await main();