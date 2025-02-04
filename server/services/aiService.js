const Groq = require('groq-sdk');
const StudyPlan = require('../models/studyPlan');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Debug log to verify environment variables
console.log('Environment check:', {
  hasGroqKey: !!process.env.GROQ_API_KEY,
  keyLength: process.env.GROQ_API_KEY?.length
});

if (!process.env.GROQ_API_KEY) {
  throw new Error('GROQ_API_KEY is not set in environment variables');
}

// Initialize Groq client with explicit API key
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Initialize cache with 30 minutes TTL
const cache = new NodeCache({ stdTTL: 1800 });

// Rate limiter for AI requests - 100 requests per IP per hour
const aiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again after an hour'
});

async function searchTavily(subject) {
  // Cache key for Tavily search
  const cacheKey = `tavily_${subject}`;
  
  // Check cache first
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.TAVILY_API_KEY}`
      },
      body: JSON.stringify({
        query: `best free learning resources tutorials courses guides documentation for learning ${subject}`,
        search_depth: "advanced",
        include_answer: true,
        max_results: 15,
        search_type: "learning",
        include_domains: [
          "coursera.org",
          "khanacademy.org",
          "freecodecamp.org",
          "w3schools.com",
          "developer.mozilla.org",
          "docs.microsoft.com",
          "tutorialspoint.com",
          "geeksforgeeks.org",
          "youtube.com",
          "medium.com",
          "udemy.com",
          "udacity.com",
        ]
      })
    });

    if (!response.ok) {
      throw new Error('Tavily search failed');
    }

    const result = await response.json();
    // Cache the result
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Tavily search error:', error);
    return { results: [], answer: '' };
  }
}

async function curateResources(searchData, subject) {
  // Cache key for curated resources
  const cacheKey = `resources_${subject}`;
  
  // Check cache first
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are an expert educator who curates high-quality learning resources. 
          Your task is to analyze search results and create a curated list of the best free learning resources.
          Focus on reputable platforms, comprehensive tutorials, and well-structured courses.
          Always verify resources are freely accessible and relevant.
          Respond in JSON format only.`
        },
        {
          role: "user",
          content: `Analyze and curate exactly 5 of the most valuable and high-quality free learning resources for ${subject}.
          
          Search Context:
          ${searchData.answer ? `${searchData.answer}\n` : ''}
          ${searchData.results ? `Additional Results:\n${JSON.stringify(searchData.results, null, 2)}\n` : ''}
          
          Requirements:
          1. Resources must be completely free to access
          2. Include a mix of different learning formats (video, interactive, documentation, etc.)
          3. Focus on beginner-friendly but comprehensive resources
          4. Prioritize well-known educational platforms and official documentation
          5. Each resource should offer clear learning value
          
          Return a JSON response with exactly 5 resources in this format:
          {
            "resources": [
              {
                "title": "Resource name (include platform name if relevant)",
                "url": "Direct URL to the resource",
                "description": "Detailed 2-3 sentence description of what the resource offers",
                "benefits": [
                  "Specific benefit or feature that makes this resource valuable",
                  "Another unique advantage of this resource",
                  "Why this resource is particularly good for learning this subject"
                ],
                "format": "Type of resource (e.g., Video Course, Interactive Tutorial, Documentation, etc.)",
                "difficulty_level": "Beginner/Intermediate/Advanced"
              }
            ]
          }`
        }
      ],
      temperature: 0.7,
      max_completion_tokens: 2048,
      top_p: 1,
      stream: false,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    
    // Validate the result structure
    if (!result.resources || !Array.isArray(result.resources) || result.resources.length === 0) {
      throw new Error('Invalid resource format received from AI');
    }

    // Cache the result
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Groq error:', error);
    throw error;
  }
}

async function generatePlan(subject, userId, examDate) {
  // Cache key for study plan
  const cacheKey = `plan_${subject}_${examDate}`;
  
  // Check cache first
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  // Calculate days until exam
  const daysUntilExam = Math.ceil(
    (new Date(examDate) - new Date()) / (1000 * 60 * 60 * 24)
  );

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are an expert study planner who creates detailed and effective study plans. Always respond in JSON format."
        },
        {
          role: "user",
          content: `Create a detailed study plan for ${subject} with ${daysUntilExam} days until the exam on ${examDate}.
          
          Return the response in this exact JSON format:
          {
            "overview": {
              "subject": "${subject}",
              "duration": "${daysUntilExam} days",
              "examDate": "${examDate}"
            },
            "weeklyPlans": [
              {
                "week": "Week 1",
                "goals": ["Goal 1", "Goal 2"],
                "dailyTasks": [
                  {
                    "day": "YYYY-MM-DD (Day X)",
                    "tasks": ["Task 1", "Task 2"],
                    "duration": "X hours"
                  }
                ]
              }
            ],
            "recommendations": ["Tip 1", "Tip 2"]
          }`
        }
      ],
      temperature: 0.7,
      max_completion_tokens: 1024,
      top_p: 1,
      stream: false,
      response_format: { type: "json_object" }
    });

    const parsedPlan = JSON.parse(completion.choices[0]?.message?.content || "{}");
    
    // Validate the required fields
    if (!parsedPlan.overview || !parsedPlan.weeklyPlans || !parsedPlan.recommendations) {
      throw new Error('Missing required fields in plan structure');
    }
    
    // Create a new StudyPlan instance
    const plan = new StudyPlan({
      userId,
      overview: {
        subject: parsedPlan.overview.subject,
        duration: parsedPlan.overview.duration,
        examDate: parsedPlan.overview.examDate
      },
      weeklyPlans: parsedPlan.weeklyPlans.map(week => ({
        week: week.week,
        goals: week.goals,
        dailyTasks: week.dailyTasks.map(task => ({
          day: task.day,
          tasks: task.tasks,
          duration: task.duration
        }))
      })),
      recommendations: parsedPlan.recommendations,
      isActive: true,
      progress: 0,
      lastUpdated: new Date()
    });

    // Cache the result
    cache.set(cacheKey, plan);
    return plan;
  } catch (error) {
    console.error('Groq error:', error);
    throw error;
  }
}

module.exports = {
  searchTavily,
  curateResources, // Changed from curateResourcesWithGroq to match the function name
  generatePlan,
  aiRateLimiter
}; 