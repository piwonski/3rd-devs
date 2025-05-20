import path from "path";
import fs from "fs";

export class FileUtils {

    getFiles(directoryName: string): string[] {
        const directory = path.join(__dirname, directoryName);
        try {
            return fs.readdirSync(directory);
        } catch (error) {
            console.error('Error reading directory:', error);
            return [];
        }
    }
}