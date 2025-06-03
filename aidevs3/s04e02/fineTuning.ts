import * as fs from 'fs';
import * as path from 'path';

const inputDir = path.join(__dirname, 'input-files');
const outputDir = path.join(__dirname, 'output-files');

// Create output-files directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

const outputFile = path.join(outputDir, 'training_data.jsonl');

// Read input files
const correctData = fs.readFileSync(path.join(inputDir, 'correct.txt'), 'utf-8')
    .split('\n')
    .filter(line => line.trim() !== '');

const incorrectData = fs.readFileSync(path.join(inputDir, 'incorect.txt'), 'utf-8')
    .split('\n')
    .filter(line => line.trim() !== '');

// Create training data
const trainingData = [
    ...correctData.map(line => ({
        messages: [
            { role: 'system', content: 'validate data' },
            { role: 'user', content: line },
            { role: 'assistant', content: '1' }
        ]
    })),
    ...incorrectData.map(line => ({
        messages: [
            { role: 'system', content: 'validate data' },
            { role: 'user', content: line },
            { role: 'assistant', content: '0' }
        ]
    }))
];

// Write to JSONL file
const jsonlContent = trainingData
    .map(entry => JSON.stringify(entry))
    .join('\n');

fs.writeFileSync(outputFile, jsonlContent);

console.log(`Created training data file with ${trainingData.length} entries`);
console.log(`Correct entries: ${correctData.length}`);
console.log(`Incorrect entries: ${incorrectData.length}`);
console.log(`Output saved to: ${outputFile}`);
