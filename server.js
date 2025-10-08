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

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'HighLevel Audit API is running',
    version: '2.0.0',
    features: ['contacts', 'conversations', 'transcriptions', 'chat', 'audit']
  });
});

// ============================================
// HIGHLEVEL DATA ENDPOINTS (Read-only)
// ============================================

// Get all contacts
app.get('/api/contacts', async (req, res) => {
  try {
    const { limit = 100, query } = req.query;
    
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
    
    res.json({
      success: true,
      contacts: response.data.contacts || [],
      total: response.data.total,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get single contact
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
    
    res.json({
      success: true,
      contact: response.data.contact,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get conversations for a contact
app.get('/api/conversations/:contactId', async (req, res) => {
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
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get messages in a conversation
app.get('/api/messages/:conversationId', async (req, res) => {
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
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// TRANSCRIPTION ENDPOINTS
// ============================================

// Transcribe audio by message ID
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
    
    // Download recording
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
    
    // Transcribe
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

// Get recording URL (without downloading)
app.get('/api/recording/:messageId', (req, res) => {
  const recordingUrl = `https://services.leadconnectorhq.com/conversations/messages/${req.params.messageId}/locations/${HIGHLEVEL_LOCATION_ID}/recording`;
  
  res.json({
    success: true,
    messageId: req.params.messageId,
    recordingUrl,
    note: 'Use this URL with proper authorization to download the recording'
  });
});

// ============================================
// FLEXIBLE CHAT ENDPOINT
// ============================================

app.post('/api/chat', async (req, res) => {
  try {
    const { 
      messages,           // Array de mensajes [{role: 'user', content: '...'}]
      systemPrompt,       // System prompt personalizado (opcional)
      model = 'claude-sonnet-4-5-20250929',
      maxTokens = 4000,
      temperature,
      context             // Contexto adicional (contacto, transcripción, etc)
    } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        success: false,
        error: 'messages array is required'
      });
    }
    
    // Agregar contexto al último mensaje si existe
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
// COMPLETE AUDIT WORKFLOW (All-in-one)
// ============================================

app.post('/api/audit', async (req, res) => {
  try {
    const { 
      messageId,
      contactId,
      auditPrompt,        // Prompt personalizado desde el frontend
      includeContactInfo = true,
      includeTranscription = true,
      transcriptionLanguage = 'es',
      model = 'claude-sonnet-4-5-20250929',
      maxTokens = 4000,
    } = req.body;
    
    if (!messageId || !contactId) {
      return res.status(400).json({
        success: false,
        error: 'messageId and contactId are required'
      });
    }
    
    if (!auditPrompt) {
      return res.status(400).json({
        success: false,
        error: 'auditPrompt is required. Define it in the frontend.'
      });
    }
    
    console.log(`Starting audit - Message: ${messageId}, Contact: ${contactId}`);
    
    let contact = null;
    let transcription = null;
    let contextParts = [];
    
    // 1. Get contact info if requested
    if (includeContactInfo) {
      console.log('Fetching contact info...');
      const contactResponse = await axios.get(
        `https://services.leadconnectorhq.com/contacts/${contactId}`,
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
        }
      );
      contact = contactResponse.data.contact;
      
      contextParts.push(`**INFORMACIÓN DEL CONTACTO:**
- Nombre: ${contact.firstName} ${contact.lastName}
- Email: ${contact.email || 'No disponible'}
- Teléfono: ${contact.phone || 'No disponible'}
- Tags: ${contact.tags?.join(', ') || 'Ninguno'}`);
    }
    
    // 2. Transcribe if requested
    if (includeTranscription) {
      console.log('Downloading and transcribing audio...');
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
      
      const audioBuffer = Buffer.from(audioResponse.data);
      const audioFile = new File([audioBuffer], 'recording.mp3', { type: 'audio/mpeg' });
      
      const transcriptionResult = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: transcriptionLanguage,
        response_format: 'verbose_json',
      });
      
      transcription = transcriptionResult;
      
      contextParts.push(`**DURACIÓN:** ${Math.floor(transcription.duration / 60)}m ${Math.floor(transcription.duration % 60)}s

**TRANSCRIPCIÓN:**
${transcription.text}`);
    }
    
    // 3. Send to Claude with custom prompt
    console.log('Sending to Claude for analysis...');
    
    const fullPrompt = `${auditPrompt}

${contextParts.join('\n\n')}`;
    
    const claudeResponse = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: fullPrompt
      }]
    });
    
    const auditResult = claudeResponse.content[0].text;
    
    console.log('Audit completed successfully');
    
    res.json({
      success: true,
      messageId,
      contactId,
      contact: contact ? {
        name: `${contact.firstName} ${contact.lastName}`,
        email: contact.email,
        phone: contact.phone,
        tags: contact.tags,
      } : null,
      transcription: transcription ? {
        text: transcription.text,
        language: transcription.language,
        duration: transcription.duration,
      } : null,
      audit: auditResult,
      usage: {
        inputTokens: claudeResponse.usage.input_tokens,
        outputTokens: claudeResponse.usage.output_tokens,
      },
    });
    
  } catch (error) {
    console.error('Audit error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// ============================================
// BATCH OPERATIONS
// ============================================

// Transcribe multiple messages at once
app.post('/api/batch/transcribe', async (req, res) => {
  try {
    const { messageIds, language = 'es' } = req.body;
    
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'messageIds array is required'
      });
    }
    
    const results = [];
    
    for (const messageId of messageIds) {
      try {
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
        
        const audioBuffer = Buffer.from(audioResponse.data);
        const audioFile = new File([audioBuffer], 'recording.mp3', { type: 'audio/mpeg' });
        
        const transcription = await openai.audio.transcriptions.create({
          file: audioFile,
          model: 'whisper-1',
          language: language,
        });
        
        results.push({
          messageId,
          success: true,
          transcription: transcription.text,
        });
        
      } catch (error) {
        results.push({
          messageId,
          success: false,
          error: error.message,
        });
      }
    }
    
    res.json({
      success: true,
      results,
      total: messageIds.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    });
    
  } catch (error) {
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
  console.log(`🚀 HighLevel Audit API v2.0 running on port ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`🎯 Endpoints:`);
  console.log(`   GET  /api/contacts`);
  console.log(`   GET  /api/contacts/:contactId`);
  console.log(`   GET  /api/conversations/:contactId`);
  console.log(`   GET  /api/messages/:conversationId`);
  console.log(`   POST /api/transcribe`);
  console.log(`   POST /api/chat (fully flexible)`);
  console.log(`   POST /api/audit (custom prompts)`);
  console.log(`   POST /api/batch/transcribe`);
});
