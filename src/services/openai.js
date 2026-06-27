import OpenAI from "openai";

const ENV_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: ENV_API_KEY,
  dangerouslyAllowBrowser: true,
});

export const Why_Do_Anything_Questions = [
  "Before we jump in, do you mind sharing what prompted you to take today's meeting and what would make this conversation valuable for you?",
  "What challenges is that creating for the business, and if you could wave a magic wand and fix it, what would success look like?",
];

export const BusinessValue_Questions = [
  "What challenges is that creating for the business, and if you could wave a magic wand and fix it, what would success look like?",
];

export const EconomicBuyer_Questions = [
  "Who ultimately owns the budget and final approval?"
];

export const Champion_Questions = [
  "Who is driving the evaluation and what role will you play in the process?",
];

export const DecisionCriteria_Questions = [
  "When it comes time to make a decision, what will your team need to see to feel confident moving forward?"
];

export const DecisionProcess_Questions = [
  "Who else will be involved in evaluating or approving a decision?",
  "Can you walk me through how a decision for a solution like this typically gets made—from this conversation through project kickoff?",
  "Assuming everything went well, when would you ideally like to have something like this in place?",
];

export const PaperProcess_Questions = [
  "If your team decided to move forward with a solution like this, what procurement, legal, security, or contracting steps would typically be involved?"
];

export const CURRENTENVIRONMENT_Questions = [
  "Can you walk me through your current approach today?",
  "Aside from us, what other options are being considered, whether that's doing nothing, building internally, or evaluating other vendors?"
];

export const NextSteps_Questions = [
  "Based on our conversation today, what do you feel would be the most valuable next step?",
];

export const ALL_QUESTIONS = [
  ...Why_Do_Anything_Questions,
  ...BusinessValue_Questions,
  ...EconomicBuyer_Questions,
  ...Champion_Questions,
  ...DecisionCriteria_Questions,
  ...DecisionProcess_Questions,
  ...PaperProcess_Questions,
  ...CURRENTENVIRONMENT_Questions,
  ...NextSteps_Questions
];

// Helper to generate SHA-256 hash for prompt cache key
async function getHash(string) {
  try {
    const utf8 = new TextEncoder().encode(string);
    const hashBuffer = await crypto.subtle.digest('SHA-256', utf8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    let hash = 0;
    for (let i = 0; i < string.length; i++) {
      const char = string.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return "fallback-" + Math.abs(hash);
  }
}

// Updated to accept a custom list of questions to track
export async function getSalesCoaching(transcriptChunk, questionsToTrack = ALL_QUESTIONS) {
  if (!ENV_API_KEY) {
    console.error("[Q4Magic] No API Key found in .env file!");
    return null;
  }

  const systemPrompt = `
  You are analyzing an ongoing sales meeting transcript between a SalesRep and one or more buyers/prospects/customers.
 
Your task is to extract only buyer-provided answers that satisfy the MEDDPICC tracking questions below.
 
Context:
- The transcript may be partial and ongoing.
- Answers may change as the meeting progresses.
- A question is only answered when the buyer/prospect/customer explicitly provides concrete information that answers it.
- Seller questions, suggestions, assumptions, or restatements do not count as answers.
- Use only information explicitly stated in the transcript.
- Do not infer, fabricate, assume, or fill gaps.
Do NOT fabricate or generate placeholder/default statements (such as "The urgency to solve this issue is being discussed, but no specific details have been provided", "No details were provided", "The topic is being discussed", etc.). If no meaningful/substantial answer/information is provided by the customer in the transcript, do not mark the question as answered, and do NOT include it in "extracted_answers".
- If a question is unanswered, partially answered, or insufficiently answered, do not include it in 'extracted_answers'.
- If a buyer provides a concrete but brief answer, summarize it accurately.
- If the buyer later updates or contradicts an earlier answer, use the latest explicit buyer-provided information from the transcript.
- Each answer must be concise and no more than 100 words.
- Include only questions that have been explicitly and substantially answered by the buyer/prospect/customer.
- The 'question' value must exactly match one of the tracking questions.
- The 'answer' value must summarize only the buyer/prospect/customer’s actual answer.
- The 'status' value must always be "answered" for included items.
- Do not include pending, unanswered, partially answered, or insufficiently answered questions.

QUESTIONS TO TRACK (Verify if these specific questions are answered in the transcript):
  ${questionsToTrack.map((q, idx) => `${idx + 1}. "${q}"`).join('\n    ')}

Output requirements:
Return only a valid JSON object.
Do not include markdown, commentary, explanations, or text outside the JSON.
Use this exact structure:
 
{
  "extracted_answers": [
    {
      "question": "The exact question text from the tracking list",
      "answer": "A concise summary of the participant's answer, max 100 words",
      "status": "answered"
    }
  ]
}
 
Rules for output:
- Include only questions that have been explicitly and substantially answered by the buyer/prospect/customer.
- The 'question' value must exactly match one of the tracking questions.
- The 'answer' value must summarize only the buyer/prospect/customer’s actual answer.
- The 'status' value must always be "answered" for included items.
- Do not include pending, unanswered, partially answered, or insufficiently answered questions.
- If no valid answers are found, return:
 
{
  "extracted_answers": []
}
  `

  try {
    const cacheKey = await getHash(systemPrompt);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Transcript Context: ${transcriptChunk}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
      prompt_cache_retention: "24h",
      prompt_cache_key: cacheKey,
    });

    const responseText = completion.choices[0].message.content;
    const responseJson = JSON.parse(responseText);
    // Log prompt caching details to verify it is working


    // console.log("[Q4Magic] AI JSON Response:", responseJson);
    return responseJson;
  } catch (error) {
    console.error("OpenAI SDK Error:", error);
    return null;
  }
}

// New function: final meeting summary
export async function getMeetingSummary(fullTranscript, capturedAnswers) {
  if (!ENV_API_KEY) {
    console.error("[Q4Magic] No API Key found for summary!");
    return null;
  }

  const systemPrompt = `
  You are a sales intelligence analyst trained in MEDDPICC qualification.
  Your task is to analyze a transcript between a sales representative and one or more buyers, then produce a structured MEDDPICC-compliant meeting summary.
  Context:
  The transcript may include multiple speakers, incomplete sentences, informal language, filler words, repeated statements, unclear speaker labels, and changing answers during the meeting. Extract only information that is explicitly stated or strongly supported by the transcript. Do not invent, assume, infer beyond the transcript, or add placeholder data.
  
  Important Extraction Rules:
    -- Read the full transcript carefully before producing the output.
    -- Use only information explicitly stated in the transcript.
    -- A field should be populated only if the customer, prospect, or buyer provides meaningful and concrete information.
    -- Do not populate a field only because the sales representative asked a question.
    -- Do not add placeholder statements such as:
      -- "No details were provided"
      -- "Not mentioned"
      -- "The topic was discussed"
      -- "The customer is evaluating options"
      -- "To be determined"
      -- "N/A"
    -- If a field is not clearly supported by the transcript, set it to null.
    -- If the same topic is discussed multiple times and the answer changes later in the meeting, use the latest clearly stated customer-provided information.
    -- Summarize professionally and concisely. Do not quote unless the exact wording is necessary for accuracy.
    -- Return only valid JSON.
  MEDDPICC Mapping:
    - Identify and map information relevant to:
    - Metrics
    - Economic Buyer
    - Decision Criteria
    - Decision Process
    - Paper Process
    - Identify Pain
    - Champion
    - Competition
  Date and Day Normalization Rules:
    - Default year for date is always current running year.
    - If the buyer/customer/prospect mentions a date, day, or relative timeline, normalize it into U.S. date format: MM/DD/YYYY.
    - Use the Reference Date to resolve relative dates or days.
  Examples:
    - "tomorrow" should be converted based on the Reference Date.
    - "next Monday" should be converted based on the Reference Date.
    - "by Friday" should be converted to the nearest future Friday based on the Reference Date.
    - If the transcript includes a date without a year, use the year from the Reference Date unless the context clearly indicates a different year.
    - If the date cannot be confidently resolved, preserve the original wording and do not invent a date.
    - Only normalize dates or days mentioned by the buyer/customer/prospect or clearly agreed as next steps.
    - Do not create dates that are not mentioned in the transcript.
  KeyContacts Rules:
    Include only people explicitly referenced in the meeting.
    For each person identify:
    - Name exactly as stated in transcript
    - Role in deal if supported

    Allowed titles:
    - Economic Buyer
    - Champion
    - Decision Maker
    - Influencer
    - Evaluator
    - Procurement
    - Security
    - Legal
    - Executive Sponsor
    - CRO
    - CFO
    - CEO
    - Director
    - VP

    Rules:
    - Do not invent names
    - Do not create contacts from generic references such as "leadership", "finance team", "IT", or "procurement"
    - Exclude unnamed stakeholders
    - Exclude uncertain contacts
    unless an actual person is identified in the transcript.
    - Do not infer MEDDPICC roles unless the transcript clearly supports them.
    - Do not include the sales representative as a KeyContact unless they are relevant to agreed next steps and clearly named.
    - If a person is mentioned but their role is not stated, include their name and set title to null.
  If no clear key contacts are identified, set KeyContacts to null.
  Do not add dummy names, placeholder contacts, or demo contacts.
  Output Requirements:
    - Return only valid JSON.
    - Do not include markdown.
    - Do not include explanations before or after the JSON.
    - Do not include placeholder text.
    - Do not include dummy or demo data.
    - Do not add fields that are not in the schema.
    - Use null, not "null", for missing values.
    - All dates included in the JSON should use U.S. format MM/DD/YYYY when they can be confidently resolved.
    - Do NOT include any dates (such as MM/DD/YYYY or formatted dates) only NextSteps data.
  JSON Schema:
  {
    "Why_Do_Anything": "Summarize the customer's pain points, desired outcomes, and consequences of inaction as a list of key points (each point on a new line starting with a dash '-'). This maps to Identify Pain. Set to null if not mentioned.",
    "BusinessValue": "Summarize success metrics, ROI expectations, business impact, and what prompted the search for a solution as a list of key points (each point on a new line starting with a dash '-'). This maps to Metrics. Set to null if not mentioned.",
    "KeyContacts": [
    {
    "name": "Full or partial name exactly as supported by the transcript",
    "title": "Title/Role (Champion, Economic Buyer, etc.)",
    "role": "string"
    }
    ],  
    "NextSteps": "Summarize agreed next steps, owners, timing, decision timeline, and implementation plan. Convert buyer-mentioned dates or days to MM/DD/YYYY when confidently resolvable. Return list of key points (each point on a new line starting with a dash '-'). but in string format. like "- point1\n- point2\n- point3"",
    "DecisionMap": "Summarize the decision process, timeline, procurement steps, security review, legal review, approval path, buying process, and evaluation criteria. This maps to Decision Criteria, Decision Process, and Paper Process. Convert buyer-mentioned dates or days to MM/DD/YYYY when confidently resolvable. Set to null if not mentioned.",
    "CurrentEnvironment": "Summarize the customer's current environment, current process, tech stack, existing tools, alternative solutions, competitors, or status quo. This maps to Competition. Set to null if not mentioned."
  }
Before finalizing the JSON, perform this validation silently:
  -- Remove any KeyContacts that are generic, invented, unnamed, or unsupported.
  -- Confirm every populated field is supported by customer/prospect/buyer statements or clearly agreed meeting outcomes.
  -- Confirm unanswered or weakly supported fields are null.
  -- Confirm all confidently resolvable dates are formatted as MM/DD/YYYY.
  -- Confirm the final response is valid JSON only.
  `

  try {
    const cacheKey = await getHash(systemPrompt);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Full Transcript: ${fullTranscript}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      prompt_cache_retention: "24h",
      prompt_cache_key: cacheKey,
    });

    const summaryJson = JSON.parse(completion.choices[0].message.content);


    return summaryJson;
  } catch (error) {
    console.error("Final summary error:", error);
    return null;
  }
}

export async function getEndMeetingSummaryBrief(fullTranscript) {
  if (!ENV_API_KEY) {
    console.error("[Q4Magic] No API Key found for summary!");
    return null;
  }

  const systemPrompt = `
  You are a sales intelligence analyst trained in MEDDIC qualification.
  Your task is to analyze a transcript between a sales representative and one or more buyers, then produce a structured MEDDIC-compliant meeting summary in Brief. 
PRIMARY RULES

- Use only information explicitly stated by the buyer, prospect, customer, or mutually agreed meeting outcomes.
- Never invent, infer, assume, or speculate.
- Do not use seller assumptions, recommendations, hypotheses, or interpretations as facts.
- If information is missing, unclear, weakly supported, or not directly stated, return null.
- Write for executives, sales leadership, account teams, and deal review meetings.
- Focus on deal strategy, business value, qualification status, decision dynamics, risks, and next actions.
- Preserve names, titles, company references, and terminology exactly as used in the transcript whenever possible.
- All dates in the output must use MM/DD/YYYY format when they can be confidently resolved.
- If a relative date is mentioned (e.g., "next Tuesday", "in two weeks" ,"end of month", "start of month", "next week", "next month", "next quarter", "next year", "next half"),convert it only when the meeting date is known and the conversion is unambiguous; otherwise retain the original wording.
- Return valid JSON only.
- Default date year always current year.
- Do not include markdown, explanations, comments, or additional text.

EXTRACTION GUIDELINES

1. BusinessValue (MEDDIC: Metrics)
   Capture:

- Business objectives
- Desired outcomes
- Success criteria
- Quantified goals
- KPIs
- ROI expectations
- Cost savings
- Productivity gains
- Revenue impact
- Risk reduction
- Compliance benefits
- Strategic initiatives

Output format:

- Do NOT begin or prefix each point with "- ", bullet points, or list symbols.
- One key point per line
- Include only buyer-provided information
- Set to null if not mentioned

2. Why_Do_Anything (MEDDIC)
   Capture:

- Current business challenges
- Pain points
- Operational inefficiencies
- Risks
- Bottlenecks
- Customer complaints
- Financial impact
- Compliance concerns
- Reasons for evaluating change
- Consequences of maintaining the status quo
- Urgency drivers

Output format:

- Do NOT begin or prefix each point with "- ", bullet points, or list symbols.
- One key point per line
- Include only buyer-provided information
- Set to null if not mentioned

3. KeyContacts (MEDDIC)
Include only people explicitly referenced in the meeting.
For each person identify:
- Name exactly as stated in transcript
- Role in deal if supported

Allowed titles:
- Economic Buyer
- Champion
- Decision Maker
- Influencer
- Evaluator
- Procurement
- Security
- Legal
- Executive Sponsor
- CRO
- CFO
- CEO
- Director
- VP

Rules:
- Do not invent names
- Do not create contacts from generic references such as "leadership", "finance team", "IT", or "procurement"
- Exclude unnamed stakeholders
- Exclude uncertain contacts

4. DecisionMap (MEDDIC: Decision Process + Paper Process)

Capture:
- Evaluation criteria
- Vendor selection process
- Stakeholders involved
- Approval workflow
- Procurement requirements
- Legal review requirements
- Security review requirements
- Budget approval requirements
- Timeline to decision
- Competitive evaluation process

Output format:
String

5. NextSteps
Capture only agreed actions.
For each action include:
- Action item
- Owner

Rules:
- Do NOT include any dates (such as MM/DD/YYYY or formatted dates) in this NextSteps summary.
- Do not create action items
- Do not include recommendations from the seller unless accepted by the buyer
- Set to null if not mentioned

Output format:
Return list of key points (each point on a new line starting with a dash '-'). but in string format. like "- point1\n- point2\n- point3"

6. CurrentEnvironment (MEDDIC: Competition / Current State)

Capture:
- Existing tools
- Current systems
- Current process
- Internal workflows
- Technology stack
- Competitors being evaluated
- Alternative solutions
- Manual processes
- Status quo environment

Output format:
String

7. ToDos

Extract actionable tasks only from NextSteps.

Capture only actions that were explicitly agreed upon during the meeting.

For each task identify:

- related_to: The business topic, project, feature, evaluation, implementation phase, demo, proposal, contract, pricing discussion, integration, or initiative the task is associated with.
- task: A concise action statement.
- due_date: Use MM/DD/YYYY when explicitly stated or confidently resolvable. Otherwise null and Default year for date is always current running year.

Rules:

- Only create tasks from agreed NextSteps.
- Do not infer tasks from general discussion.
- Do not create tasks from seller recommendations unless accepted by the buyer.
- Do not create duplicate tasks.
- Keep task descriptions short and actionable.
- If no actionable task exists, return an empty array.

Examples:
Input:
"The customer will review pricing and provide feedback next week."

Output:
{
  "related_to": "Pricing Evaluation",
  "task": "Review pricing and provide feedback",
  "due_date": null
}

OUTPUT SCHEMA

{
"Why_Do_Anything": "string or null",
"BusinessValue": "string or null",
"KeyContacts": [
{
"name": "exact transcript-supported name",
"title": "Economic Buyer | Champion | Decision Maker | Influencer | Evaluator | Procurement | Security | Legal | Executive Sponsor",
"role": "string"
}
],
"NextSteps": "string or null",
"DecisionMap": "string or null",
"CurrentEnvironment": "string or null",
"ToDos": [
    {
      "related_to": "string",
      "task": "string",
      "due_date": "MM/DD/YYYY or null"
    }
  ]
}

FINAL VALIDATION (PERFORM SILENTLY)

Before returning JSON:

1. Remove unsupported facts.
2. Remove all inferred information.
3. Remove unnamed stakeholders.
4. Remove generic contacts.
5. Remove seller assumptions.
6. Ensure every populated field is supported by transcript evidence.
7. Ensure weakly supported information is null.
8. Ensure all dates use MM/DD/YYYY when confidently resolvable.
9. Ensure valid JSON syntax.
10. Ensure output contains JSON only.
11. Ensure empty arrays are returned for KeyContacts when no supported contacts exist.
  `

  try {
    const cacheKey = await getHash(systemPrompt);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Full Transcript: ${fullTranscript}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      prompt_cache_retention: "24h",
      prompt_cache_key: cacheKey,
    });

    const summaryJson = JSON.parse(completion.choices[0].message.content);


    return summaryJson;
  } catch (error) {
    console.error("Final summary error:", error);
    return null;
  }
}

export async function getMeetingNotes(fullTranscript, capturedAnswers) {
  if (!ENV_API_KEY) {
    console.error("[Q4Magic] No API Key found for summary!");
    return null;
  }

  const systemPrompt = `
You are the 360Pipe Executive Brief Generator.
Analyze the complete meeting transcript and all captured discovery data.
Rules:
Use only information discussed.
Do not invent facts.
Clearly identify assumptions and gaps.
Write for executives and sales leadership.
Focus on deal strategy, business value, and next actions.
Return JSON only.
For nextSteps return list of key points (each point on a new line starting with a dash '-'). but in string format. like "- point1\n- point2\n- point3"
Generate:
Executive Summary
5-7 sentence overview of the opportunity.
Business Problem
Key pain points driving change.
Business impact of maintaining the status quo.
Desired Outcomes
Business goals and success criteria.
Metrics discussed.
Buying Team
Economic Buyer
Champion
Decision Makers
Influencers
Decision Process
Evaluation criteria
Approval process
Procurement, legal, and security requirements
Deal Assessment
Strengths
Risks
Missing information
Recommended Strategy
Key messages for the next meeting
Stakeholders to engage
Questions that must be answered
Next Meeting Objective
Desired outcome
Recommended agenda
Success criteria
Return:
{
"executiveSummary":"",
"businessProblem":[],
"desiredOutcomes":[],
"buyingTeam":{},
"decisionProcess":{},
"dealAssessment":{
"strengths":[],
"risks":[],
"gaps":[]
},
"recommendedStrategy":[],
"nextMeetingObjective":{},
"nextSteps":[],
}

`;

  try {
    const cacheKey = await getHash(systemPrompt);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Full Transcript: ${fullTranscript}\n\nPreviously Captured Answers (JSON): ${JSON.stringify(capturedAnswers)}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      prompt_cache_retention: "24h",
      prompt_cache_key: cacheKey,
    });

    const summaryJson = JSON.parse(completion.choices[0].message.content);


    return summaryJson;
  } catch (error) {
    console.error("Final summary error:", error);
    return null;
  }
}

export async function getWrapupAssistant(fullTranscript, capturedAnswers) {
  if (!ENV_API_KEY) {
    console.error("[Q4Magic] No API Key found for summary!");
    return null;
  }
  const systemPrompt = `
You are the 360Pipe Align & End Call Engine.
Analyze the complete meeting transcript and captured answers.
Rules:
- Use only information discussed.
- Do not invent facts.
- Identify assumptions separately.
- Be concise and actionable.
- Return valid JSON only containing the exact structure below.

JSON Schema Output:
{
  "meetingSummary": "High-level summary of the meeting",
  "whyChange": {
    "painPoints": ["list of identified pain points"],
    "businessDrivers": ["list of business drivers"],
    "urgency": "Urgency description"
  },
  "value": {
    "desiredOutcomes": ["list of desired outcomes"],
    "metricsDiscussed": ["list of metrics discussed"],
    "expectedImpact": "Expected impact/ROI"
  },
  "keyContacts": {
    "economicBuyer": "Name of Economic Buyer, or 'Not discussed'",
    "champion": "Name of Champion, or 'Not discussed'",
    "decisionMakers": ["List of other decision makers"],
    "influencers": ["List of influencers"]
  },
  "decisionMap": {
    "evaluationCriteria": ["list of criteria"],
    "decisionProcess": ["list of process steps"],
    "procurementRequirements": ["list of procurement requirements"]
  },
  "currentEnvironment": {
    "existingTools": ["list of existing tools"],
    "existingProcesses": ["list of existing processes"],
    "currentChallenges": ["list of current challenges"]
  },
  "nextSteps": [
    {
      "action": "Description of action item",
      "owner": "Who is responsible",
      "dueDate": "When it is due"
    }
  ],
  "risksGaps": {
    "missingInformation": ["list of missing details"],
    "dealRisks": ["list of risks"]
  },
  "meddpiccMapping": {
    "metrics": "How Metrics are mapped",
    "economicBuyer": "How Economic Buyer is mapped",
    "decisionCriteria": "How Decision Criteria is mapped",
    "decisionProcess": "How Decision Process is mapped",
    "paperProcess": "How Paper Process is mapped",
    "identifyPain": "How Identify Pain is mapped",
    "champion": "How Champion is mapped"
  }
}
`;

  try {
    const cacheKey = await getHash(systemPrompt);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Full Transcript: ${fullTranscript}\n\nPreviously Captured Answers (JSON): ${JSON.stringify(capturedAnswers)}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      prompt_cache_retention: "24h",
      prompt_cache_key: cacheKey,
    });

    const summaryJson = JSON.parse(completion.choices[0].message.content);


    return summaryJson;
  } catch (error) {
    console.error("Final summary error:", error);
    return null;
  }
}

export async function extractCurrentEnvironment(answersText) {
  if (!ENV_API_KEY) {
    console.error("[Q4Magic] No API Key found for dynamic extraction!");
    return null;
  }

  const systemPrompt = `
You are an AI assistant that extracts software/process solutions and their vendors from sales conversation notes.
Analyze the text provided and identify:
1. The general category of solutions mentioned (e.g., "CRM", "Notes", "Competitors", "Database", "Calendar").
2. The specific vendors or tools mentioned under each category (e.g., "HubSpot", "Excel", "Word", "Facebook").

Rules:
- Group vendors under their respective solution category.
- For all vendors that are explicitly mentioned as used, being considered, or discussed, set isChecked to true by default.
- Return a JSON object with a single key "result" which is an array of solution objects.
- Only include solutions and vendors that are explicitly mentioned in the text.
- Do NOT invent or add any placeholder solutions or vendors if they are not in the text.
- If no tools or vendors are mentioned, return {"result": []}.

JSON Output Format:
{
  "result": [
    {
      "solution": "CRM",
      "vendors": [
        { "isChecked": true, "value": "HubSpot" },
        { "isChecked": true, "value": "Salesforce" }
      ]
    },
    {
      "solution": "Notes",
      "vendors": [
        { "isChecked": true, "value": "Excel" },
        { "isChecked": true, "value": "Word" }
      ]
    }
  ]
}
`;

  try {
    const cacheKey = await getHash(systemPrompt);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Text: ${answersText}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      prompt_cache_retention: "24h",
      prompt_cache_key: cacheKey,
    });

    const responseText = completion.choices[0].message.content;
    const responseJson = JSON.parse(responseText);
    return responseJson;
  } catch (error) {
    console.error("Dynamic extraction error:", error);
    return null;
  }
}

export async function extractDecisionProcess(answersText) {
  if (!ENV_API_KEY) {
    console.error("[Q4Magic] No API Key found for dynamic extraction!");
    return null;
  }

  const systemPrompt = `
You are an AI assistant that extracts DecisionProcess from sales conversation notes.

Input:
A DecisionMap field extracted from a sales meeting transcript and the meeting date.

Your task:
Extract every distinct decision, approval, evaluation, review, procurement, legal, security, implementation, vendor-selection, milestone, or timeline process mentioned.

Rules:

- Use only information explicitly stated.
- Do not infer missing contacts, dates, or process owners.
- If a contact is not mentioned, set contact_name to null.
- Extract all process-related activities, reviews, approvals, milestones, evaluations, procurement steps, legal steps, security steps, implementation targets, and decision deadlines.
- Create one object per process.
- If the same process contains multiple stages (e.g., procurement, legal review, security review), create separate objects.
- Preserve process names in concise business language.
- Ignore general observations that do not represent a process, milestone, review, approval, evaluation, procurement activity, legal activity, security activity, or decision activity.
- Return a JSON object with a single key "result" which contains the array of process objects.

DATE RESOLUTION RULES
When extracting process_date:
1. Use MM/DD/YYYY format whenever the date can be confidently resolved.
2. Resolve explicit dates:
   - July 31, 2026 → 07/31/2026
   - 31 July 2026 → 07/31/2026
3. Resolve relative dates ONLY when the meeting date is known and the interpretation is unambiguous.
Examples (assuming meeting date = 06/15/2026):
- next week → 06/22/2026
- in two weeks → 06/29/2026
- next month → 07/01/2026
- start of next month → 07/01/2026
- end of next month → 07/31/2026
- next quarter → 07/01/2026
- end of next quarter → 09/30/2026
- next year → 01/01/2027
- next half → 07/01/2026
4. Resolve month-boundary phrases:
Examples (assuming year = current year):
- start of July → 07/01/2026
- beginning of July → 07/01/2026
- mid July → 07/15/2026
- end of July → 07/31/2026
- start of month → first day of that month
- end of month → last day of that month
5. If a month is mentioned without a year:
   - Use the year implied by the meeting date when unambiguous.
   - Example:
     Meeting date = 06/15/2026
     "end of July" → 07/31/2026
6. If multiple interpretations are possible:
   - Set process_date to null.
7. Default year for date is always current running year.

Examples:
- sometime next quarter → null
- later this year → null
- around July → null
- coming months → null

7. Never invent a date when confidence is low.
PROCESS NAME NORMALIZATION
Use concise business process names such as:
- Vendor Selection
- RFP Process
- Product Demo
- Proof of Concept
- Security Review
- Legal Review
- Contract Review
- MSA Review
- Procurement Review
- Budget Approval
- Executive Approval
- AI Model Evaluation
- Competitive Evaluation
- Implementation Target
- Decision Deadline
- Pilot Program
- Technical Evaluation

CONTACT EXTRACTION
- Use only names explicitly mentioned in the transcript or DecisionMap.
- Do not create contacts from generic references such as:

  - leadership
  - finance team
  - procurement
  - legal
  - security
  - executives
  - stakeholders
- If no named person is associated with the process, set contact_name to null.

Output Schema:
{
  "result": [
    {
      "process_name": "string",
      "contact_name": "string or null",
      "process_date": "MM/DD/YYYY or null"
    }
  ]
}

FINAL VALIDATION
Before returning the JSON:
1. Remove duplicate processes.
2. Remove unsupported contacts.
3. Remove inferred contacts.
4. Remove invented dates.
5. Ensure all confidently resolvable dates use MM/DD/YYYY.
6. Ensure each process represents a real decision, review, approval, evaluation, milestone, procurement activity, legal activity, security activity, implementation target, or timeline step.
7. Exclude statements that merely describe preferences, observations, requirements, competitors, or options unless they are part of an actual evaluation process.
8. Return valid JSON object only matching the output schema.
`;

  try {
    const cacheKey = await getHash(systemPrompt);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Text: ${answersText}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      prompt_cache_retention: "24h",
      prompt_cache_key: cacheKey,
    });

    const responseText = completion.choices[0].message.content;
    const responseJson = JSON.parse(responseText);
    let list = [];
    if (responseJson && Array.isArray(responseJson.result)) {
      list = responseJson.result;
    } else if (responseJson && Array.isArray(responseJson.processes)) {
      list = responseJson.processes;
    } else if (responseJson && Array.isArray(responseJson.DecisionMap)) {
      list = responseJson.DecisionMap;
    } else if (Array.isArray(responseJson)) {
      list = responseJson;
    }
    const seen = new Set();
    const unique = [];
    for (const item of list) {
      if (item && item.process_name) {
        const key = item.process_name.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(item);
        }
      }
    }
    return unique;
  } catch (error) {
    console.error("Dynamic extraction error:", error);
    return null;
  }
}