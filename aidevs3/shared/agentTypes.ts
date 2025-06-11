export interface Question {
    id: string;
    text: string;
}

export interface Feedback {
    headquartersHint: string;
    incorrectValue: string;
    transformedHint: string;
}

export interface Answer {
    questionId: string;
    message: string;
}

export interface QuestionWithContext extends Question {
    feedbacks: Feedback[];
}