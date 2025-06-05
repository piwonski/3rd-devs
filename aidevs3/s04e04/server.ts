const express = require('express');

// Configurable port
const PORT = process.env.AZYL_PORT;
export const startFlightRoute = '/start-flight';

const app = express();

// Automatically parse JSON bodies
app.use(express.json());

app.post(startFlightRoute, async (req: any, res: any) => {
    try {
        console.log('Body:', req.body);
        const instruction = req.body.instruction;

        const description = await prepareDescription(instruction);
        console.log('Description:', description);
        res.json({ description });
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ error });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

async function prepareDescription(instruction: string) {
    console.log('Instruction:', instruction);
    return 'Mowa trawa';
}

const map: string[][] = [
    ['Pin lokalizacji', 'Łąka trawa',      'Drzewo pojedyncze',     'Dom budynek'],
    ['Łąka trawa',      'Młyn wiatrowy',   'Łąka trawa',            'Łąka trawa'],
    ['Łąka trawa',      'Łąka trawa',      'Skały kamienie',        'Dwa drzewa'],
    ['Góry pasmo',      'Góry szczyty',    'Samochód pojazd',       'Jaskinia wejście']
]

