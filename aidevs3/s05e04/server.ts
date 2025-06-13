const express = require('express');
import { OpenAIService } from '../shared/OpenAIService';
import { ExpenseCounter } from '../shared/ExpenseCounter';
import { heartRoute } from './routes';
import { Agent } from './agent';

// Configurable port
const PORT = 3000;

const app = express();
const expenseCounter = new ExpenseCounter();
const openAIService = new OpenAIService(3072, expenseCounter);
const agent = new Agent(openAIService); 

// Automatically parse JSON bodies
app.use(express.json());

app.post(heartRoute, async (req: any, res: any) => {
    try {
        console.log('Body:', req.body);
        const question = req.body.question;
        const answer = await agent.answer(question);
        
        console.log("💰 Total tokens used so far:", {
            input: expenseCounter.getUsedTokens().input,
            output: expenseCounter.getUsedTokens().output,
            total: expenseCounter.getUsedTokens().total
        });
        
        res.status(200).json({ answer });
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