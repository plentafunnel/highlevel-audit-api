import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));

// CORS configuration
app.use(cors({
  origin: [
    'https://delveranda-auditor-dashboard.lovable.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const HIGHLEVEL_API_KEY = process.env.HIGHLEVEL_API_KEY;
const HIGHLEVEL_LOCATION_ID = process.env.HIGHLEVEL_LOCATION_ID;

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'HighLevel Audit API is running',
    version: '2.3.0',
    database: 'Supabase PostgreSQL',
    features: [
      'contacts',
      'opportunities',
      'conversations', 
      'transcriptions',
      'chat',
      'chat-mcp',
      'audit',
      'prompts-management',
      'full-contact-analysis',
      'persistent-storage'
    ]
  });
});

// ============================================
// HIGHLEVEL DATA ENDPOINTS
// ============================================

// Get all contacts with Supabase cache
app.get('/api/contacts', async (req, res) => {
  try {
    const { limit = 100, query, refresh = false } = req.query;
    
    const { count } = await supabase
      .from('contacts_cache')
      .select('*', { count: 'exact', head: true });
    
    if (refresh === 'true' || count === 0) {
      const params = {
        location_id: HIGHLEVEL_LOCATION_ID,
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
      
      const contactsToCache = response.data.contacts.map(contact => ({
        contact_id: contact.id,
        full_name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
        email: contact.email,
        phone: contact.phone,
        tags: contact.tags,
        last_synced: new Date().toISOString(),
      }));
      
      if (contactsToCache.length > 0) {
        await supabase
          .from('contacts_cache')
          .upsert(contactsToCache, { onConflict: 'contact_id' });
      }
    }
    
    let dbQuery = supabase
      .from('contacts_cache')
      .select('*')
      .order('last_synced', { ascending: false });
    
    if (query) {
      dbQuery = dbQuery.or(`full_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%,contact_id.ilike.%${query}%`);
    }
    
    const { data: contacts, error } = await dbQuery.limit(parseInt(limit));
    
    if (error) throw error;
    
    res.json({
      success: true,
      contacts: contacts.map(c => ({
        contactId: c.contact_id,
        fullName: c.full_name,
        email: c.email,
        phone: c.phone,
        tags: c.tags,
        lastSynced: c.last_synced,
        hasAnalysis: c.has_analysis,
      })),
      total: contacts.length,
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

// Get conversations for a contact
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
          location_id: HIGHLEVEL_LOCATION_ID,
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
// OPPORTUNITIES ENDPOINTS
// ============================================

// Get all pipelines
app.get('/api/pipelines', async (req, res) => {
  try {
    const response = await axios.get(
      `https://services.leadconnectorhq.com/opportunities/pipelines`,
      {
        headers: {
          Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
          Version: '2021-07-28',
        },
        params: {
          location_id: HIGHLEVEL_LOCATION_ID,
        },
      }
    );
    
    res.json({
      success: true,
      pipelines: response.data.pipelines || [],
    });
  } catch (error) {
    console.error('Error getting pipelines:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || null,
    });
  }
});

// Get opportunities with filters and pagination
app.get('/api/opportunities', async (req, res) => {
  try {
    const { 
      pipelineId, 
      status,
      limit = 100,
      startAfter,
      startAfterId,
      query 
    } = req.query;
    
    console.log('Getting opportunities with params:', {
      pipelineId,
      status,
      limit,
      startAfter,
      startAfterId,
      query
    });
    
    const params = {
      location_id: HIGHLEVEL_LOCATION_ID,
      limit: parseInt(limit),
    };
    
    if (pipelineId && pipelineId !== 'all' && pipelineId !== '') {
      params.pipelineId = pipelineId;
    }
    
    if (status && status !== 'all' && status !== '') {
      params.status = status;
    }
    
    if (startAfterId) {
      params.startAfterId = startAfterId;
    } else if (startAfter) {
      params.startAfterId = startAfter;
    }
    
    if (query && query.trim() !== '') {
      params.q = query.trim();
    }
    
    console.log('Final params for HighLevel API:', params);
    
    const response = await axios.get(
      'https://services.leadconnectorhq.com/opportunities/search',
      {
        headers: {
          Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
          Version: '2021-07-28',
        },
        params,
      }
    );
    
    console.log(`Got ${response.data.opportunities?.length || 0} opportunities`);
    
    const opportunities = response.data.opportunities || [];
    const batchSize = 5;
    const opportunitiesWithContacts = [];
    
    for (let i = 0; i < opportunities.length; i += batchSize) {
      const batch = opportunities.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(async (opp) => {
          try {
            if (opp.contact && opp.contact.email && opp.contact.phone) {
              const { data: analysis } = await supabase
                .from('analyses')
                .select('id')
                .eq('contact_id', opp.contact.id)
                .limit(1)
                .single();
              
              return {
                id: opp.id,
                name: opp.name,
                pipelineId: opp.pipelineId,
                pipelineStageId: opp.pipelineStageId,
                status: opp.status,
                monetaryValue: opp.monetaryValue,
                assignedTo: opp.assignedTo,
                contact: {
                  id: opp.contact.id,
                  name: opp.contact.name || 'Unknown',
                  email: opp.contact.email,
                  phone: opp.contact.phone,
                },
                hasAnalysis: !!analysis,
                createdAt: opp.createdAt,
                lastStatusChangeAt: opp.lastStatusChangeAt,
              };
            }
            
            const contactResponse = await axios.get(
              `https://services.leadconnectorhq.com/contacts/${opp.contact.id}`,
              {
                headers: {
                  Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
                  Version: '2021-07-28',
                },
              }
            );
            
            const contact = contactResponse.data.contact;
            
            const { data: analysis } = await supabase
              .from('analyses')
              .select('id')
              .eq('contact_id', opp.contact.id)
              .limit(1)
              .single();
            
            return {
              id: opp.id,
              name: opp.name,
              pipelineId: opp.pipelineId,
              pipelineStageId: opp.pipelineStageId,
              status: opp.status,
              monetaryValue: opp.monetaryValue,
              assignedTo: opp.assignedTo,
              contact: {
                id: contact.id,
                name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
                email: contact.email,
                phone: contact.phone,
              },
              hasAnalysis: !!analysis,
              createdAt: opp.createdAt,
              lastStatusChangeAt: opp.lastStatusChangeAt,
            };
          } catch (err) {
            console.error(`Error processing opportunity ${opp.id}:`, err.message);
            return {
              id: opp.id,
              name: opp.name,
              pipelineId: opp.pipelineId,
              pipelineStageId: opp.pipelineStageId,
              status: opp.status,
              monetaryValue: opp.monetaryValue,
              assignedTo: opp.assignedTo,
              contact: {
                id: opp.contact?.id || 'unknown',
                name: opp.contact?.name || 'Unknown',
                email: null,
                phone: null,
              },
              hasAnalysis: false,
              createdAt: opp.createdAt,
              lastStatusChangeAt: opp.lastStatusChangeAt,
            };
          }
        })
      );
      
      opportunitiesWithContacts.push(...batchResults);
    }
    
    res.json({
      success: true,
      opportunities: opportunitiesWithContacts,
      total: response.data.meta?.total || opportunitiesWithContacts.length,
      nextStartAfterId: response.data.meta?.nextStartAfterId || null,
      nextStartAfter: response.data.meta?.nextStartAfterId || null,
    });
  } catch (error) {
    console.error('Error getting opportunities:', error.message);
    console.error('Error details:', error.response?.data || error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || null,
    });
  }
});

// Get single opportunity
app.get('/api/opportunities/:opportunityId', async (req, res) => {
  try {
    const response = await axios.get(
      `https://services.leadconnectorhq.com/opportunities/${req.params.opportunityId}`,
      {
        headers: {
          Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
          Version: '2021-07-28',
        },
      }
    );
    
    const opp = response.data.opportunity;
    
    const contactResponse = await axios.get(
      `https://services.leadconnectorhq.com/contacts/${opp.contact.id}`,
      {
        headers: {
          Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
          Version: '2021-07-28',
        },
      }
    );
    
    const contact = contactResponse.data.contact;
    
    res.json({
      success: true,
      opportunity: {
        id: opp.id,
        name: opp.name,
        pipelineId: opp.pipelineId,
        pipelineStageId: opp.pipelineStageId,
        status: opp.status,
        monetaryValue: opp.monetaryValue,
        assignedTo: opp.assignedTo,
        contact: {
          id: contact.id,
          name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
          email: contact.email,
          phone: contact.phone,
          tags: contact.tags,
        },
        createdAt: opp.createdAt,
        lastStatusChangeAt: opp.lastStatusChangeAt,
      }
    });
  } catch (error) {
    console.error('Error getting opportunity:', error.message);
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

app.get('/api/prompts/history', async (req, res) => {
  try {
    const { data: prompts, error } = await supabase
      .from('prompts')
      .select('*')
      .order('version', { ascending: false });
    
    if (error) throw error;
    
    const active = prompts.find(p => p.is_active);
    
    res.json({
      success: true,
      prompts: prompts.map(p => ({
        id: p.id,
        version: p.version,
        content: p.content,
        settings: p.settings,
        createdAt: p.created_at,
        createdBy: p.created_by,
        isActive: p.is_active,
      })),
      active: active ? {
        id: active.id,
        version: active.version,
        content: active.content,
        settings: active.settings,
        createdAt: active.created_at,
        createdBy: active.created_by,
        isActive: active.is_active,
      } : null,
    });
  } catch (error) {
    console.error('Error getting prompts:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get('/api/prompts/active', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('prompts')
      .select('*')
      .eq('is_active', true)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    res.json({
      success: true,
      prompt: data ? {
        id: data.id,
        version: data.version,
        content: data.content,
        settings: data.settings,
        createdAt: data.created_at,
        createdBy: data.created_by,
        isActive: data.is_active,
      } : null,
      message: data ? null : 'No active prompt set'
    });
  } catch (error) {
    console.error('Error getting active prompt:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post('/api/prompts', async (req, res) => {
  try {
    const { content, settings, createdBy } = req.body;
    
    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'content is required'
      });
    }
    
    const { data: maxData } = await supabase
      .from('prompts')
      .select('version')
      .order('version', { ascending: false })
      .limit(1)
      .single();
    
    const nextVersion = (maxData?.version || 0) + 1;
    
    await supabase
      .from('prompts')
      .update({ is_active: false })
      .eq('is_active', true);
    
    const { data: newPrompt, error } = await supabase
      .from('prompts')
      .insert({
        version: nextVersion,
        content,
        settings: settings || {
          includeContactInfo: true,
          includeWhatsApp: true,
          includeSMS: true,
          includeCalls: true,
          model: 'claude-sonnet-4-5-20250929',
          language: 'es'
        },
        created_by: createdBy || 'user',
        is_active: true,
      })
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      prompt: {
        id: newPrompt.id,
        version: newPrompt.version,
        content: newPrompt.content,
        settings: newPrompt.settings,
        createdAt: newPrompt.created_at,
        createdBy: newPrompt.created_by,
        isActive: newPrompt.is_active,
      },
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

app.post('/api/prompts/:id/restore', async (req, res) => {
  try {
    await supabase
      .from('prompts')
      .update({ is_active: false })
      .eq('is_active', true);
    
    const { data: restored, error } = await supabase
      .from('prompts')
      .update({ is_active: true })
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    
    if (!restored) {
      return res.status(404).json({
        success: false,
        error: 'Prompt not found'
      });
    }
    
    res.json({
      success: true,
      prompt: {
        id: restored.id,
        version: restored.version,
        content: restored.content,
        settings: restored.settings,
        createdAt: restored.created_at,
        createdBy: restored.created_by,
        isActive: restored.is_active,
      },
      message: `Prompt v${restored.version} restored and activated`
    });
  } catch (error) {
    console.error('Error restoring prompt:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.delete('/api/prompts/:id', async (req, res) => {
  try {
    const { data: deleted, error } = await supabase
      .from('prompts')
      .delete()
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Prompt not found'
      });
    }
    
    if (deleted.is_active) {
      const { data: latest } = await supabase
        .from('prompts')
        .select('*')
        .order('version', { ascending: false })
        .limit(1)
        .single();
      
      if (latest) {
        await supabase
          .from('prompts')
          .update({ is_active: true })
          .eq('id', latest.id);
      }
    }
    
    res.json({
      success: true,
      message: `Prompt v${deleted.version} deleted`
    });
  } catch (error) {
    console.error('Error deleting prompt:', error.message);
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
    
    let prompt;
    if (promptId) {
      const { data } = await supabase
        .from('prompts')
        .select('*')
        .eq('id', promptId)
        .single();
      prompt = data;
    } else {
      const { data } = await supabase
        .from('prompts')
        .select('*')
        .eq('is_active', true)
        .single();
      prompt = data;
    }
    
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'No active prompt found. Please create a prompt first.'
      });
    }
    
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
    
    console.log('Step 2/4: Fetching conversations...');
    const conversationsResponse = await axios.get(
      'https://services.leadconnectorhq.com/conversations/search',
      {
        headers: {
          Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
          Version: '2021-07-28',
        },
        params: {
          location_id: HIGHLEVEL_LOCATION_ID,
          contactId: contactId,
          limit: 100,
        },
      }
    );
    
    const conversations = conversationsResponse.data.conversations || [];
    
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
        if (msg.type === 'TYPE_CALL' && includeCalls) {
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
    
    console.log('Step 4/4: Running AI analysis...');
    
    let contextParts = [];
    
    if (prompt.settings.includeContactInfo) {
      contextParts.push(`**INFORMACIÓN DEL CONTACTO:**
- Nombre: ${contact.firstName} ${contact.lastName}
- Email: ${contact.email || 'No disponible'}
- Teléfono: ${contact.phone || 'No disponible'}
- Tags: ${contact.tags?.join(', ') || 'Ninguno'}
- Fuente: ${contact.source || 'No especificada'}`);
    }
    
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
    
    const claudeResponse = await anthropic.messages.create({
      model: prompt.settings.model || 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `${prompt.content}\n\n${fullContext}`
      }]
    });
    
    const analysisText = claudeResponse.content[0].text;
    
    const { data: savedAnalysis, error: saveError } = await supabase
      .from('analyses')
      .insert({
        contact_id: contactId,
        contact_name: `${contact.firstName} ${contact.lastName}`,
        prompt_version: prompt.version,
        prompt_id: prompt.id,
        analysis_text: analysisText,
        transcriptions: transcriptions,
        metadata: {
          totalMessages: allMessages.length,
          totalCalls: transcriptions.length,
          analysisDate: new Date().toISOString(),
        },
      })
      .select()
      .single();
    
    if (saveError) throw saveError;
    
    console.log('Analysis completed and saved successfully');
    
    res.json({
      success: true,
      analysis: {
        id: savedAnalysis.id,
        contactId: savedAnalysis.contact_id,
        contactName: savedAnalysis.contact_name,
        promptVersion: savedAnalysis.prompt_version,
        promptId: savedAnalysis.prompt_id,
        analysisText: savedAnalysis.analysis_text,
        transcriptions: savedAnalysis.transcriptions,
        metadata: savedAnalysis.metadata,
        createdAt: savedAnalysis.created_at,
      },
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

app.get('/api/analyses/:contactId/latest', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('analyses')
      .select('*')
      .eq('contact_id', req.params.contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    res.json({
      success: true,
      analysis: data ? {
        id: data.id,
        contactId: data.contact_id,
        contactName: data.contact_name,
        promptVersion: data.prompt_version,
        promptId: data.prompt_id,
        analysisText: data.analysis_text,
        transcriptions: data.transcriptions,
        metadata: data.metadata,
        createdAt: data.created_at,
      } : null,
      message: data ? null : 'No analysis found for this contact'
    });
  } catch (error) {
    console.error('Error getting latest analysis:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get('/api/analyses/:contactId', async (req, res) => {
  try {
    const { data: analyses, error } = await supabase
      .from('analyses')
      .select('*')
      .eq('contact_id', req.params.contactId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      analyses: analyses.map(a => ({
        id: a.id,
        contactId: a.contact_id,
        contactName: a.contact_name,
        promptVersion: a.prompt_version,
        promptId: a.prompt_id,
        analysisText: a.analysis_text,
        transcriptions: a.transcriptions,
        metadata: a.metadata,
        createdAt: a.created_at,
      })),
      total: analyses.length,
    });
  } catch (error) {
    console.error('Error getting analyses:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post('/api/analyses/:contactId/reanalyze', async (req, res) => {
  try {
    const { promptId } = req.body;
    
    return app._router.handle(
      { ...req, url: '/api/analyze-contact', method: 'POST', body: {
        contactId: req.params.contactId,
        promptId,
        includeWhatsApp: true,
        includeSMS: true,
        includeCalls: true,
      }},
      res
    );
    
  } catch (error) {
    console.error('Error reanalyzing contact:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// FLEXIBLE CHAT ENDPOINT
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
// MCP-ENABLED CHAT
// ============================================

const mcpTools = [
  {
    name: "get_contacts",
    description: "Obtiene la lista de contactos de HighLevel. Puedes filtrar por query, limitar resultados, etc.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Número de contactos a obtener (default: 20)"
        },
        query: {
          type: "string",
          description: "Búsqueda por nombre, email o teléfono"
        }
      }
    }
  },
  {
    name: "get_contact",
    description: "Obtiene información detallada de un contacto específico por ID",
    input_schema: {
      type: "object",
      properties: {
        contactId: {
          type: "string",
          description: "ID del contacto"
        }
      },
      required: ["contactId"]
    }
  },
  {
    name: "get_conversations",
    description: "Obtiene las conversaciones de un contacto específico",
    input_schema: {
      type: "object",
      properties: {
        contactId: {
          type: "string",
          description: "ID del contacto"
        },
        limit: {
          type: "number",
          description: "Número de conversaciones a obtener"
        }
      },
      required: ["contactId"]
    }
  },
  {
    name: "get_conversation_messages",
    description: "Obtiene los mensajes de una conversación específica",
    input_schema: {
      type: "object",
      properties: {
        conversationId: {
          type: "string",
          description: "ID de la conversación"
        },
        limit: {
          type: "number",
          description: "Número de mensajes a obtener"
        }
      },
      required: ["conversationId"]
    }
  },
  {
    name: "transcribe_recording",
    description: "Transcribe una grabación de llamada usando Whisper",
    input_schema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "ID del mensaje que contiene la grabación"
        }
      },
      required: ["messageId"]
    }
  }
];

async function executeMCPTool(toolName, toolInput) {
  console.log(`Executing MCP tool: ${toolName}`, toolInput);
  
  try {
    switch (toolName) {
      case "get_contacts": {
        const { limit = 20, query } = toolInput;
        const params = {
          location_id: HIGHLEVEL_LOCATION_ID,
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
        
        return {
          contacts: response.data.contacts.map(c => ({
            id: c.id,
            name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
            email: c.email,
            phone: c.phone,
            tags: c.tags,
            dateAdded: c.dateAdded,
          })),
          total: response.data.total,
        };
      }
      
      case "get_contact": {
        const { contactId } = toolInput;
        const response = await axios.get(
          `https://services.leadconnectorhq.com/contacts/${contactId}`,
          {
            headers: {
              Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
              Version: '2021-07-28',
            },
          }
        );
        
        const contact = response.data.contact;
        return {
          id: contact.id,
          name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
          email: contact.email,
          phone: contact.phone,
          tags: contact.tags,
          source: contact.source,
          dateAdded: contact.dateAdded,
          customFields: contact.customFields,
        };
      }
      
      case "get_conversations": {
        const { contactId, limit = 50 } = toolInput;
        const response = await axios.get(
          'https://services.leadconnectorhq.com/conversations/search',
          {
            headers: {
              Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
              Version: '2021-07-28',
            },
            params: {
              location_id: HIGHLEVEL_LOCATION_ID,
              contactId: contactId,
              limit: parseInt(limit),
            },
          }
        );
        
        return {
          conversations: response.data.conversations || [],
          total: response.data.conversations?.length || 0,
        };
      }
      
      case "get_conversation_messages": {
        const { conversationId, limit = 100 } = toolInput;
        const response = await axios.get(
          `https://services.leadconnectorhq.com/conversations/${conversationId}/messages`,
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
        
        return {
          messages: response.data.messages || [],
          total: response.data.messages?.length || 0,
        };
      }
      
      case "transcribe_recording": {
        const { messageId } = toolInput;
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
          language: 'es',
        });
        
        return {
          transcription: transcription.text,
          duration: transcription.duration,
        };
      }
      
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`Error executing ${toolName}:`, error.message);
    return {
      error: error.message,
    };
  }
}

app.post('/api/chat-mcp', async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;
    
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'message is required'
      });
    }
    
    console.log(`MCP Chat request: "${message}"`);
    
    const messages = [
      ...conversationHistory,
      {
        role: "user",
        content: message
      }
    ];
    
    let response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4000,
      tools: mcpTools,
      messages: messages
    });
    
    console.log(`Stop reason: ${response.stop_reason}`);
    
    while (response.stop_reason === "tool_use") {
      const toolUse = response.content.find(block => block.type === "tool_use");
      
      if (!toolUse) break;
      
      console.log(`Claude wants to use tool: ${toolUse.name}`);
      
      const toolResult = await executeMCPTool(toolUse.name, toolUse.input);
      
      messages.push({
        role: "assistant",
        content: response.content
      });
      
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(toolResult)
          }
        ]
      });
      
      response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4000,
        tools: mcpTools,
        messages: messages
      });
      
      console.log(`Stop reason: ${response.stop_reason}`);
    }
    
    const finalResponse = response.content.find(block => block.type === "text")?.text || 
                          "No pude generar una respuesta.";
    
    res.json({
      success: true,
      response: finalResponse,
      conversationHistory: [
        ...conversationHistory,
        {
          role: "user",
          content: message
        },
        {
          role: "assistant",
          content: finalResponse
        }
      ],
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      }
    });
    
  } catch (error) {
    console.error('MCP Chat error:', error.message);
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
  console.log(`🚀 HighLevel Audit API v2.3 running on port ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`💾 Database: Supabase PostgreSQL`);
  console.log(`🎯 Features:`);
  console.log(`   - Persistent storage with Supabase`);
  console.log(`   - Prompts management with versioning`);
  console.log(`   - Full contact analysis`);
  console.log(`   - Opportunities with filters`);
  console.log(`   - MCP-enabled intelligent chat`);
  console.log(`   - Contacts caching`);
  console.log(`   - Analysis history`);
});
