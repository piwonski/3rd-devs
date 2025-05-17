export interface TestItem {
    question: string;
    answer: number;
    test?: TestQuestion;
}

export interface TestQuestion {
    q: string;
    a: string;
}

export interface CalibrationData {
    apikey: string;
    description: string;
    copyright: string;
    "test-data": TestItem[];
}

