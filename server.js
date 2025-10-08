#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execPromise = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HIGHLEVEL_API_KEY = process.env.HIGHLEVEL_API_KEY;
const HIGHLEVEL_LOCATION_ID = process.env.HIGHLEVEL_LOCATION_ID;

const server = new Server(
  {
    name: 'highlevel-mcp-server',
    version: '1.3.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_contacts',
        description: 'Obtiene la lista de contactos de HighLevel',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Número de contactos a obtener',
            },
          },
        },
      },
      {
        name: 'get_contact',
        description: 'Obtiene información de un contacto específico por ID',
        inputSchema: {
          type: 'object',
          properties: {
            contactId: {
              type: 'string',
              description: 'ID del contacto',
            },
          },
          required: ['contactId'],
        },
      },
      {
        name: 'get_conversations',
        description: 'Obtiene las conversaciones de un contacto específico',
        inputSchema: {
          type: 'object',
          properties: {
            contactId: {
              type: 'string',
              description: 'ID del contacto',
            },
            limit: {
              type: 'number',
              description: 'Número de conversaciones a obtener',
            },
          },
          required: ['contactId'],
        },
      },
      {
        name: 'get_conversation_messages',
        description: 'Obtiene los mensajes de una conversación específica',
        inputSchema: {
          type: 'object',
          properties: {
            conversationId: {
              type: 'string',
              description: 'ID de la conversación',
            },
            limit: {
              type: 'number',
              description: 'Número de mensajes a obtener',
            },
          },
          required: ['conversationId'],
        },
      },
      {
        name: 'get_recording_url',
        description: 'Obtiene la URL de la grabación de un mensaje',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: {
              type: 'string',
              description: 'ID del mensaje',
            },
          },
          required: ['messageId'],
        },
      },
      {
        name: 'transcribe_recording',
        description: 'Descarga la grabación de un mensaje y la transcribe usando Whisper LOCAL (gratis)',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: {
              type: 'string',
              description: 'ID del mensaje',
            },
            model: {
              type: 'string',
              description: 'Modelo de Whisper (tiny, base, small, medium, large)',
            },
          },
          required: ['messageId'],
        },
      },
      {
        name: 'get_transcription_by_message_id',
        description: 'Obtiene la transcripción de un mensaje específico si existe en HighLevel',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: {
              type: 'string',
              description: 'ID del mensaje',
            },
          },
          required: ['messageId'],
        },
      },
      {
        name: 'get_opportunities',
        description: 'Obtiene la lista de oportunidades',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Número de oportunidades a obtener',
            },
            pipelineId: {
              type: 'string',
              description: 'ID del pipeline',
            },
          },
        },
      },
      {
        name: 'get_opportunity',
        description: 'Obtiene información de una oportunidad específica',
        inputSchema: {
          type: 'object',
          properties: {
            opportunityId: {
              type: 'string',
              description: 'ID de la oportunidad',
            },
          },
          required: ['opportunityId'],
        },
      },
      {
        name: 'get_pipelines',
        description: 'Obtiene la lista de pipelines disponibles',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_locations',
        description: 'Obtiene la lista de locations',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Número de locations a obtener',
            },
          },
        },
      },
      {
        name: 'get_location',
        description: 'Obtiene información de una location específica',
        inputSchema: {
          type: 'object',
          properties: {
            locationId: {
              type: 'string',
              description: 'ID de la location',
            },
          },
          required: ['locationId'],
        },
      },
      {
        name: 'get_users',
        description: 'Obtiene la lista de usuarios de la location',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Número de usuarios a obtener',
            },
          },
        },
      },
      {
        name: 'get_user',
        description: 'Obtiene información de un usuario específico',
        inputSchema: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'ID del usuario',
            },
          },
          required: ['userId'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'get_contacts') {
      const limit = args.limit || 10;
      const response = await axios.get(
        'https://services.leadconnectorhq.com/contacts/',
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
          params: {
            locationId: HIGHLEVEL_LOCATION_ID,
            limit: limit,
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === 'get_contact') {
      const response = await axios.get(
        `https://services.leadconnectorhq.com/contacts/${args.contactId}`,
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === 'get_conversations') {
      const limit = args.limit || 20;
      const response = await axios.get(
        'https://services.leadconnectorhq.com/conversations/search',
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
          params: {
            locationId: HIGHLEVEL_LOCATION_ID,
            contactId: args.contactId,
            limit: limit,
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === 'get_conversation_messages') {
      const limit = args.limit || 50;
      const response = await axios.get(
        `https://services.leadconnectorhq.com/conversations/${args.conversationId}/messages`,
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
          params: {
            limit: limit,
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === 'get_recording_url') {
      const recordingUrl = `https://services.leadconnectorhq.com/conversations/messages/${args.messageId}/locations/${HIGHLEVEL_LOCATION_ID}/recording`;
      
      const urlInfo = {
        messageId: args.messageId,
        locationId: HIGHLEVEL_LOCATION_ID,
        recordingUrl: recordingUrl,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(urlInfo, null, 2),
          },
        ],
      };
    }

    if (name === 'transcribe_recording') {
      const recordingUrl = `https://services.leadconnectorhq.com/conversations/messages/${args.messageId}/locations/${HIGHLEVEL_LOCATION_ID}/recording`;
      const model = args.model || 'small';
      const tempDir = path.join(__dirname, 'temp');
      
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const audioPath = path.join(tempDir, `${args.messageId}.mp3`);
      
      console.error(`Iniciando transcripción para mensaje: ${args.messageId}`);
      console.error(`Descargando audio de: ${recordingUrl}`);
      
      const audioResponse = await axios.get(recordingUrl, {
        headers: {
          Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
          Version: '2021-07-28',
        },
        responseType: 'arraybuffer',
        maxContentLength: 25 * 1024 * 1024,
        maxBodyLength: 25 * 1024 * 1024,
        timeout: 90000,
      });

      fs.writeFileSync(audioPath, Buffer.from(audioResponse.data));
      console.error(`Audio guardado: ${(audioResponse.data.length / (1024 * 1024)).toFixed(2)}MB`);
      console.error(`Transcribiendo con Whisper (modelo: ${model})...`);

      const { stdout, stderr } = await execPromise(
        `python3 -m whisper "${audioPath}" --model ${model} --language Spanish --output_format json --output_dir "${tempDir}"`
      );

      console.error('Transcripción completada');

      const jsonPath = path.join(tempDir, `${args.messageId}.json`);
      const transcriptionData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

      fs.unlinkSync(audioPath);
      fs.unlinkSync(jsonPath);

      const result = {
        messageId: args.messageId,
        locationId: HIGHLEVEL_LOCATION_ID,
        transcription: transcriptionData.text,
        language: transcriptionData.language,
        segments: transcriptionData.segments,
        model: model,
        success: true,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_transcription_by_message_id') {
      const response = await axios.get(
        `https://services.leadconnectorhq.com/conversations/messages/${args.messageId}/transcription`,
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === 'get_opportunities') {
      const limit = args.limit || 20;
      const params = {
        location_id: HIGHLEVEL_LOCATION_ID,
        limit: limit,
      };
      
      if (args.pipelineId) {
        params.pipelineId = args.pipelineId;
      }

      const response = await axios.get(
        'https://services.leadconnectorhq.com/opportunities/search',
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
          params: params,
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === 'get_opportunity') {
      const response = await axios.get(
        `https://services.leadconnectorhq.com/opportunities/${args.opportunityId}`,
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === 'get_pipelines') {
      const response = await axios.get(
        'https://services.leadconnectorhq.com/opportunities/pipelines',
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
          params: {
            locationId: HIGHLEVEL_LOCATION_ID,
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === 'get_locations') {
      const limit = args.limit || 20;
      const response = await axios.get(
        'https://services.leadconnectorhq.com/locations/search',
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
          params: {
            limit: limit,
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === 'get_location') {
      const response = await axios.get(
        `https://services.leadconnectorhq.com/locations/${args.locationId}`,
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === 'get_users') {
      const limit = args.limit || 20;
      const response = await axios.get(
        'https://services.leadconnectorhq.com/users/',
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
          params: {
            locationId: HIGHLEVEL_LOCATION_ID,
            limit: limit,
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === 'get_user') {
      const response = await axios.get(
        `https://services.leadconnectorhq.com/users/${args.userId}`,
        {
          headers: {
            Authorization: `Bearer ${HIGHLEVEL_API_KEY}`,
            Version: '2021-07-28',
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    throw new Error(`Herramienta desconocida: ${name}`);
  } catch (error) {
    console.error('Error en la herramienta:', error.message);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.response && error.response.data ? JSON.stringify(error.response.data) : error.message}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('HighLevel MCP server v1.3.0 - Con Whisper LOCAL (GRATIS)');
}

main().catch((error) => {
  console.error('Error fatal:', error);
  process.exit(1);
});
