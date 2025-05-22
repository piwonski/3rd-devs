import fs from "fs";
import path from "path";

const inputDirectoryName = 'input-files';

async function main() {
    const mapFiles = fs.readdirSync(path.join(__dirname, inputDirectoryName))
        .map(file => path.join(__dirname, inputDirectoryName, file));
    console.log('Map files:', mapFiles);
}

await main();