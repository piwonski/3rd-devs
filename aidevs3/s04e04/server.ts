const express = require('express');
import { OpenAIService } from '../shared/OpenAIService';
import { ExpenseCounter } from '../shared/ExpenseCounter';
import { startFlightRoute } from './routes';

// Configurable port
const PORT = 3000;

const app = express();
const expenseCounter = new ExpenseCounter();

// Automatically parse JSON bodies
app.use(express.json());

app.post(startFlightRoute, async (req: any, res: any) => {
    try {
        console.log('Body:', req.body);
        const instruction = req.body.instruction;

        const description = await prepareDescription(instruction);
        console.log('Description:', description);
        console.log('Token usage:', expenseCounter.getUsedTokens());
        res.json({ description });
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ error });
    }
});

app.get('/test', (req: any, res: any) => {
    res.send('Hello World'); 
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

async function prepareDescription(instruction: string) {
    console.log('Instruction:', instruction);
    
    const openai = new OpenAIService();
    
    // Parse the instruction to get movement directions
    const systemPrompt = `You are a flight navigation parser. Given a Polish instruction about flight directions, you need to determine the final position on a 4x4 grid.

The grid is 4x4 (rows 0-3, columns 0-3). Starting position is always [0,0] (top-left corner).

Movement directions:
- "prawo" = right (increase column)
- "lewo" = left (decrease column)  
- "góra" or "w górę" = up (decrease row)
- "dół" or "w dół" = down (increase row)

When instruction says "na maksa" or "ile wlezie" it means move as far as possible in that direction until you hit the boundary.

Return ONLY a JSON object with the final coordinates:
{"row": X, "col": Y}

Examples:
- "Lecimy na maksa w prawo" → {"row": 0, "col": 3}
- "Ile wlezie w dół" → {"row": 3, "col": 0}
- "W prawo, a później w dół" → {"row": 1, "col": 1} (assuming one step each)`;

    const response = await openai.completion({
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: instruction }
        ],
        model: "gpt-4o",
        jsonMode: true
    });

    if (!('choices' in response)) {
        throw new Error('Invalid response from OpenAI');
    }

    // Track token usage
    expenseCounter.increaseCost(response);

    const content = response.choices[0].message.content;
    if (!content) {
        throw new Error('No content in response');
    }

    const coordinates = JSON.parse(content);
    const { row, col } = coordinates;
    console.log('Coordinates:', row, col);
    
    // Get the description from the map
    const description = map[row][col];
    
    return description;
}

const map: string[][] = [
    ['Pin lokalizacji', 'Łąka trawa',      'Drzewo pojedyncze',     'Dom budynek'],
    ['Łąka trawa',      'Młyn wiatrowy',   'Łąka trawa',            'Łąka trawa'],
    ['Łąka trawa',      'Łąka trawa',      'Skały kamienie',        'Dwa drzewa'],
    ['Góry pasmo',      'Góry szczyty',    'Samochód pojazd',       'Jaskinia wejście']
]

