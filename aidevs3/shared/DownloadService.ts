import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

export class DownloadService {
    private cacheDir: string;

    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;
    }

    async downloadFile(url: string, destinationFileName: string): Promise<void> {
        try {
            // Create cache directory if it doesn't exist
            if (!fs.existsSync(this.cacheDir)) {
                fs.mkdirSync(this.cacheDir, { recursive: true });
            }
            const destinationPath = path.join(this.cacheDir, destinationFileName);
            
            console.log('Downloading zip file...');
            await this.download(url, destinationPath);
            console.log('Download completed successfully!');
        } catch (error) {
            console.error('Error downloading file:', error);
        }
    }

    private async download(url: string, destinationPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destinationPath);
            https.get(url, (response) => {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(destinationPath, () => {}); // Delete the file if there was an error
                reject(err);
            });
        });
    }
}