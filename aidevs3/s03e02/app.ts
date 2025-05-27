import * as path from 'path';
import { DownloadService } from '../shared/DownloadService';
import { Environment } from '../shared/Environment';

const downloadService = new DownloadService(path.join(__dirname, 'cache'));

async function main() {
    const zipUrl = `${Environment.getHeadquartersHost()}/dane/pliki_z_fabryki.zip`;

    await downloadService.downloadFile(zipUrl, 'pliki_z_fabryki.zip');
}

await main();