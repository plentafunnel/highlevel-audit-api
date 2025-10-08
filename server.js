import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cors());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const HIGHLEVEL_API_KEY = process.env.HIGHLEVEL_API_KEY;
const HIGHLEVEL_LOCATION_ID = process.env.HIGHLEVEL_LOCATION_ID;

// In-memory storage (replace with real DB later)
let promptsStorage = [];
let analysesStorage = [];
let contactsCache = [];

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'HighLevel Audit API is running',
    version: '2.1.0',
    features: [
      'contacts',
      'conversations', 
      'transcriptions',
      'chat',
      'audit',
      'prompts-management',
      'full-contact-analysis'
    ]
  });
});

// ============================================
// HIGHLEVEL DATA ENDPOINTS
// ============================================

// Get all contacts with cache
app.get('/api/contacts', async (req, res) => {
  try {
    const { limit = 100, query, refresh = false } = req.query;
    
    // If refresh or cache is empty, fetch from HighLevel
    if (refresh === 'true' || contactsCache.length === 0) {
      const params = {
        locationId: HIGHLEVEL_LOCATION_ID,
        limit: parseInt(limit),
      };
      
      if (query) params.query = query;
      
      const response = await axios.get(
        'https://services.leadconnectorhq.com/contacts/',
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
          params,
        }
      );
      
      // Update cache
      contactsCache = response.data.contacts.map(contact => ({
        contactId: contact.id,
        fullName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
        email: contact.email,
        phone: contact.phone,
        tags: contact.tags,
        lastSynced: new Date().toISOString(),
        hasAnalysis: analysesStorage.some(a => a.contactId === contact.id)
      }));
    }
    
    // Filter if query provided
    let filtered = contactsCache;
    if (query) {
      const q = query.toLowerCase();
      filtered = contactsCache.filter(c => 
        c.fullName?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.contactId?.toLowerCase().includes(q)
      );
    }
    
    res.json({
      success: true,
      contacts: filtered,
      total: filtered.length,
      cached: refresh !== 'true'
    });
  } catch (error) {
    console.error('Error getting contacts:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get single contact with full details
app.get('/api/contacts/:contactId', async (req, res) => {
  try {
    const response = await axios.get(
      `https://services.leadconnectorhq.com/contacts/${req.params.contactId}`,
      {
        headers: {
          Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
          Version: '2021-07-28',
        },
      }
    );
    
    const contact = response.data.contact;
    
    res.json({
      success: true,
      contact: {
        id: contact.id,
        fullName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        tags: contact.tags,
        customFields: contact.customFields,
        source: contact.source,
        dateAdded: contact.dateAdded,
      }
    });
  } catch (error) {
    console.error('Error getting contact:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get all conversations for a contact
app.get('/api/contacts/:contactId/conversations', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const response = await axios.get(
      'https://services.leadconnectorhq.com/conversations/search',
      {
        headers: {
          Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
          Version: '2021-07-28',
        },
        params: {
          locationId: HIGHLEVEL_LOCATION_ID,
          contactId: req.params.contactId,
          limit: parseInt(limit),
        },
      }
    );
    
    res.json({
      success: true,
      conversations: response.data.conversations || [],
      total: response.data.conversations?.length || 0,
    });
  } catch (error) {
    console.error('Error getting conversations:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get messages from a conversation
app.get('/api/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    
    const response = await axios.get(
      `https://services.leadconnectorhq.com/conversations/${req.params.conversationId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
          Version: '2021-07-28',
        },
        params: {
          limit: parseInt(limit),
        },
      }
    );
    
    res.json({
      success: true,
      messages: response.data.messages || [],
      total: response.data.messages?.length || 0,
    });
  } catch (error) {
    console.error('Error getting messages:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// TRANSCRIPTION ENDPOINTS
// ============================================

app.post('/api/transcribe', async (req, res) => {
  try {
    const { messageId, language = 'es' } = req.body;
    
    if (!messageId) {
      return res.status(400).json({
        success: false,
        error: 'messageId is required'
      });
    }
    
    console.log(`Transcribing message: ${messageId}`);
    
    const recordingUrl = `https://services.leadconnectorhq.com/conversations/messages/${messageId}/locations/${HIGHLEVEL_LOCATION_ID}/recording`;
    
    const audioResponse = await axios.get(recordingUrl, {
      headers: {
        Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
        Version: '2021-07-28',
      },
      responseType: 'arraybuffer',
      maxContentLength: 25 * 1024 * 1024,
      timeout: 90000,
    });
    
    console.log(`Audio downloaded: ${(audioResponse.data.length / (1024 * 1024)).toFixed(2)}MB`);
    
    const audioBuffer = Buffer.from(audioResponse.data);
    const audioFile = new File([audioBuffer], 'recording.mp3', { type: 'audio/mpeg' });
    
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: language,
      response_format: 'verbose_json',
    });
    
    console.log('Transcription completed');
    
    res.json({
      success: true,
      messageId,
      transcription: transcription.text,
      language: transcription.language,
      duration: transcription.duration,
      segments: transcription.segments,
    });
    
  } catch (error) {
    console.error('Transcription error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// PROMPTS MANAGEMENT
// ============================================

// Get all prompts with history
app.get('/api/prompts/history', (req, res) => {
  try {
    const sorted = promptsStorage.sort((a, b) => b.version - a.version);
    
    res.json({
      success: true,
      prompts: sorted,
      active: sorted.find(p => p.isActive),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get active prompt
app.get('/api/prompts/active', (req, res) => {
  try {
    const active = promptsStorage.find(p => p.isActive);
    
    if (!active) {
      return res.json({
        success: true,
        prompt: null,
        message: 'No active prompt set'
      });
    }
    
    res.json({
      success: true,
      prompt: active,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Save new prompt version
app.post('/api/prompts', (req, res) => {
  try {
    const { content, settings, createdBy } = req.body;
    
    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'content is required'
      });
    }
    
    // Deactivate all previous prompts
    promptsStorage.forEach(p => p.isActive = false);
    
    // Get next version number
    const maxVersion = promptsStorage.length > 0 
      ? Math.max(...promptsStorage.map(p => p.version))
      : 0;
    
    const newPrompt = {
      id: `prompt_${Date.now()}`,
      version: maxVersion + 1,
      content,
      settings: settings || {
        includeContactInfo: true,
        includeWhatsApp: true,
        includeSMS: true,
        includeCalls: true,
        model: 'claude-sonnet-4-5-20250929',
        language: 'es'
      },
      createdAt: new Date().toISOString(),
      createdBy: createdBy || 'user',
      isActive: true,
    };
    
    promptsStorage.push(newPrompt);
    
    res.json({
      success: true,
      prompt: newPrompt,
      message: `Prompt v${newPrompt.version} saved and activated`
    });
  } catch (error) {
    console.error('Error saving prompt:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Restore a specific prompt version
app.post('/api/prompts/:id/restore', (req, res) => {
  try {
    const promptToRestore = promptsStorage.find(p => p.id === req.params.id);
    
    if (!promptToRestore) {
      return res.status(404).json({
        success: false,
        error: 'Prompt not found'
      });
    }
    
    // Deactivate all prompts
    promptsStorage.forEach(p => p.isActive = false);
    
    // Activate the selected one
    promptToRestore.isActive = true;
    
    res.json({
      success: true,
      prompt: promptToRestore,
      message: `Prompt v${promptToRestore.version} restored and activated`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Delete a prompt version
app.delete('/api/prompts/:id', (req, res) => {
  try {
    const index = promptsStorage.findIndex(p => p.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({
        success: false,
        error: 'Prompt not found'
      });
    }
    
    const deleted = promptsStorage.splice(index, 1)[0];
    
    // If deleted was active, activate the latest
    if (deleted.isActive && promptsStorage.length > 0) {
      const latest = promptsStorage.sort((a, b) => b.version - a.version)[0];
      latest.isActive = true;
    }
    
    res.json({
      success: true,
      message: `Prompt v${deleted.version} deleted`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// FULL CONTACT ANALYSIS
// ============================================

app.post('/api/analyze-contact', async (req, res) => {
  try {
    const { 
      contactId,
      promptId,
      includeWhatsApp = true,
      includeSMS = true,
      includeCalls = true,
    } = req.body;
    
    if (!contactId) {
      return res.status(400).json({
        success: false,
        error: 'contactId is required'
      });
    }
    
    console.log(`Starting full analysis for contact: ${contactId}`);
    
    // Get prompt (use provided or active)
    let prompt;
    if (promptId) {
      prompt = promptsStorage.find(p => p.id === promptId);
    } else {
      prompt = promptsStorage.find(p => p.isActive);
    }
    
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'No active prompt found. Please create a prompt first.'
      });
    }
    
    // 1. Get contact info
    console.log('Step 1/4: Fetching contact info...');
    const contactResponse = await axios.get(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      {
        headers: {
          Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
          Version: '2021-07-28',
        },
      }
    );
    const contact = contactResponse.data.contact;
    
    // 2. Get all conversations
    console.log('Step 2/4: Fetching conversations...');
    const conversationsResponse = await axios.get(
      'https://services.leadconnectorhq.com/conversations/search',
      {
        headers: {
          Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
          Version: '2021-07-28',
        },
        params: {
          locationId: HIGHLEVEL_LOCATION_ID,
          contactId: contactId,
          limit: 100,
        },
      }
    );
    
    const conversations = conversationsResponse.data.conversations || [];
    
    // 3. Extract all messages and transcribe calls
    console.log('Step 3/4: Processing messages and transcribing calls...');
    let allMessages = [];
    let transcriptions = [];
    
    for (const conv of conversations) {
      const messagesResponse = await axios.get(
        `https://services.leadconnectorhq.com/conversations/${conv.id}/messages`,
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
          params: { limit: 100 },
        }
      );
      
      const messages = messagesResponse.data.messages || [];
      
      for (const msg of messages) {
        // Filter by type
        if (msg.type === 'TYPE_CALL' && includeCalls) {
          // Transcribe call
          try {
            const recordingUrl = `https://services.leadconnectorhq.com/conversations/messages/${msg.id}/locations/${HIGHLEVEL_LOCATION_ID}/recording`;
            
            const audioResponse = await axios.get(recordingUrl, {
              headers: {
                Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
                Version: '2021-07-28',
              },
              responseType: 'arraybuffer',
              maxContentLength: 25 * 1024 * 1024,
              timeout: 90000,
            });
            
            const audioBuffer = Buffer.from(audioResponse.data);
            const audioFile = new File([audioBuffer], 'recording.mp3', { type: 'audio/mpeg' });
            
            const transcription = await openai.audio.transcriptions.create({
              file: audioFile,
              model: 'whisper-1',
              language: prompt.settings.language || 'es',
            });
            
            transcriptions.push({
              messageId: msg.id,
              type: 'CALL',
              text: transcription.text,
              duration: transcription.duration,
              date: msg.dateAdded,
            });
            
            allMessages.push({
              type: 'CALL',
              content: transcription.text,
              date: msg.dateAdded,
            });
          } catch (err) {
            console.error(`Error transcribing call ${msg.id}:`, err.message);
          }
        } else if (msg.type === 'TYPE_SMS' && includeSMS) {
          allMessages.push({
            type: 'SMS',
            content: msg.body,
            direction: msg.direction,
            date: msg.dateAdded,
          });
        } else if ((msg.type === 'TYPE_WHATSAPP' || !msg.type) && includeWhatsApp) {
          allMessages.push({
            type: 'WHATSAPP',
            content: msg.body,
            direction: msg.direction,
            date: msg.dateAdded,
          });
        }
      }
    }
    
    // 4. Build context
    console.log('Step 4/4: Running AI analysis...');
    
    let contextParts = [];
    
    // Contact info
    if (prompt.settings.includeContactInfo) {
      contextParts.push(`**INFORMACIÓN DEL CONTACTO:**
- Nombre: ${contact.firstName} ${contact.lastName}
- Email: ${contact.email || 'No disponible'}
- Teléfono: ${contact.phone || 'No disponible'}
- Tags: ${contact.tags?.join(', ') || 'Ninguno'}
- Fuente: ${contact.source || 'No especificada'}`);
    }
    
    // Messages timeline
    if (allMessages.length > 0) {
      const sortedMessages = allMessages.sort((a, b) => 
        new Date(a.date) - new Date(b.date)
      );
      
      const messagesText = sortedMessages.map(msg => {
        const date = new Date(msg.date).toLocaleString('es-ES');
        return `[${date}] ${msg.type} - ${msg.direction || ''}: ${msg.content}`;
      }).join('\n\n');
      
      contextParts.push(`**HISTORIAL DE COMUNICACIONES:**\n${messagesText}`);
    }
    
    const fullContext = contextParts.join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
    
    // 5. Send to Claude
    const claudeResponse = await anthropic.messages.create({
      model: prompt.settings.model || 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `${prompt.content}\n\n${fullContext}`
      }]
    });
    
    const analysisText = claudeResponse.content[0].text;
    
    // 6. Save analysis
    const analysis = {
      id: `analysis_${Date.now()}`,
      contactId,
      contactName: `${contact.firstName} ${contact.lastName}`,
      promptVersion: prompt.version,
      promptId: prompt.id,
      analysisText,
      transcriptions,
      metadata: {
        totalMessages: allMessages.length,
        totalCalls: transcriptions.length,
        analysisDate: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    };
    
    analysesStorage.push(analysis);
    
    // Update cache
    const cachedContact = contactsCache.find(c => c.contactId === contactId);
    if (cachedContact) {
      cachedContact.hasAnalysis = true;
    }
    
    console.log('Analysis completed successfully');
    
    res.json({
      success: true,
      analysis,
    });
    
  } catch (error) {
    console.error('Analysis error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// Get latest analysis for a contact
app.get('/api/analyses/:contactId/latest', (req, res) => {
  try {
    const analyses = analysesStorage.filter(a => a.contactId === req.params.contactId);
    
    if (analyses.length === 0) {
      return res.json({
        success: true,
        analysis: null,
        message: 'No analysis found for this contact'
      });
    }
    
    const latest = analyses.sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    )[0];
    
    res.json({
      success: true,
      analysis: latest,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get all analyses for a contact
app.get('/api/analyses/:contactId', (req, res) => {
  try {
    const analyses = analysesStorage.filter(a => a.contactId === req.params.contactId);
    
    const sorted = analyses.sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    
    res.json({
      success: true,
      analyses: sorted,
      total: sorted.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Re-analyze contact with a specific prompt
app.post('/api/analyses/:contactId/reanalyze', async (req, res) => {
  try {
    const { promptId } = req.body;
    
    // Just call analyze-contact with the same parameters
    return app._router.handle({
      ...req,
      url: '/api/analyze-contact',
      method: 'POST',
      body: {
        contactId: req.params.contactId,
        promptId,
        includeWhatsApp: true,
        includeSMS: true,
        includeCalls: true,
      }
    }, res);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// FLEXIBLE CHAT ENDPOINT (MCP Integration)
// ============================================

app.post('/api/chat', async (req, res) => {
  try {
    const { 
      messages,
      systemPrompt,
      model = 'claude-sonnet-4-5-20250929',
      maxTokens = 4000,
      temperature,
      context
    } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        success: false,
        error: 'messages array is required'
      });
    }
    
    let finalMessages = [...messages];
    if (context && finalMessages.length > 0) {
      const lastMessage = finalMessages[finalMessages.length - 1];
      lastMessage.content = `${lastMessage.content}\n\n${context}`;
    }
    
    const params = {
      model,
      max_tokens: maxTokens,
      messages: finalMessages,
    };
    
    if (systemPrompt) {
      params.system = systemPrompt;
    }
    
    if (temperature !== undefined) {
      params.temperature = temperature;
    }
    
    console.log(`Chat request with ${messages.length} messages`);
    
    const response = await anthropic.messages.create(params);
    
    res.json({
      success: true,
      response: response.content[0].text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
    });
    
  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// SERVER
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 HighLevel Audit API v2.1 running on port ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`🎯 New Features:`);
  console.log(`   - Prompts Management with versioning`);
  console.log(`   - Full Contact Analysis (WhatsApp + SMS + Calls)`);
  console.log(`   - Contacts caching`);
  console.log(`   - Analysis history`);
});

