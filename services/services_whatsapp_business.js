const axios = require('axios');
const EventEmitter = require('events');

/**
 * WhatsApp Business API Service
 * Works with Meta's WhatsApp Business Cloud API
 */
class WhatsAppBusinessService extends EventEmitter {
  constructor(phoneNumberId, accessToken) {
    super();
    this.phoneNumberId = phoneNumberId;
    this.accessToken = accessToken;
    this.apiUrl = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
    this.apiVersion = 'v18.0';
    
    console.log('📱 WhatsApp Business Service initialized');
  }

  /**
   * Send a text message via WhatsApp Business API
   */
  async sendMessage(to, message) {
    try {
      // Clean phone number (remove + and -)
      const cleanNumber = to.replace(/[+-\s]/g, '');
      
      console.log(`📤 Sending message to ${cleanNumber}`);
      console.log(`   Message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);
      
      const response = await axios({
        method: 'POST',
        url: this.apiUrl,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        data: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanNumber,
          type: 'text',
          text: {
            preview_url: false,
            body: message
          }
        }
      });
      
      console.log('✅ Message sent successfully');
      return response.data;
    } catch (error) {
      console.error('❌ Error sending message:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send an image message
   */
  async sendImage(to, imageUrl, caption = '') {
    try {
      const cleanNumber = to.replace(/[+-\s]/g, '');
      
      console.log(`📸 Sending image to ${cleanNumber}`);
      
      const response = await axios({
        method: 'POST',
        url: this.apiUrl,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        data: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanNumber,
          type: 'image',
          image: {
            link: imageUrl,
            caption: caption
          }
        }
      });
      
      console.log('✅ Image sent successfully');
      return response.data;
    } catch (error) {
      console.error('❌ Error sending image:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Setup webhook endpoints for Express app
   */
  setupWebhook(app) {
    // Webhook verification endpoint (GET)
    app.get('/webhook', (req, res) => {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      console.log('🔍 Webhook verification request');
      console.log('   Mode:', mode);
      console.log('   Token:', token ? '***' + token.slice(-4) : 'none');

      if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
        console.log('✅ Webhook verified successfully!');
        res.status(200).send(challenge);
      } else {
        console.log('❌ Webhook verification failed!');
        res.sendStatus(403);
      }
    });

    // Webhook to receive messages (POST)
    app.post('/webhook', (req, res) => {
      const body = req.body;

      // Respond immediately to acknowledge receipt
      res.sendStatus(200);

      console.log('📨 Webhook data received');

      try {
        if (body.object === 'whatsapp_business_account') {
          body.entry?.forEach(entry => {
            entry.changes?.forEach(change => {
              if (change.field === 'messages') {
                const value = change.value;
                
                // Process incoming messages
                if (value.messages) {
                  value.messages.forEach(message => {
                    console.log('📩 New message received:');
                    console.log('   From:', message.from);
                    console.log('   Type:', message.type);
                    console.log('   ID:', message.id);
                    
                    // Emit message event for processing
                    this.emit('message', {
                      from: message.from,
                      id: message.id,
                      timestamp: message.timestamp,
                      type: message.type,
                      body: message.text?.body || '',
                      image: message.image || null,
                      document: message.document || null,
                      audio: message.audio || null,
                      video: message.video || null
                    });
                  });
                }

                // Process message status updates (delivered, read, etc.)
                if (value.statuses) {
                  value.statuses.forEach(status => {
                    console.log('📊 Message status update:', status.status);
                  });
                }
              }
            });
          });
        }
      } catch (error) {
        console.error('❌ Error processing webhook:', error);
      }
    });

    console.log('✅ Webhook endpoints configured');
    console.log('   GET  /webhook - Verification');
    console.log('   POST /webhook - Message receiving');
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId) {
    try {
      const response = await axios({
        method: 'POST',
        url: this.apiUrl,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        data: {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('⚠️  Error marking message as read:', error.response?.data);
      // Don't throw - this is not critical
    }
  }

  /**
   * Send a template message (requires pre-approved templates)
   */
  async sendTemplate(to, templateName, languageCode = 'en') {
    try {
      const cleanNumber = to.replace(/[+-\s]/g, '');
      
      const response = await axios({
        method: 'POST',
        url: this.apiUrl,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        data: {
          messaging_product: 'whatsapp',
          to: cleanNumber,
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: languageCode
            }
          }
        }
      });
      
      console.log('✅ Template message sent');
      return response.data;
    } catch (error) {
      console.error('❌ Error sending template:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send a reaction to a message
   */
  async sendReaction(to, messageId, emoji) {
    try {
      const cleanNumber = to.replace(/[+-\s]/g, '');
      
      const response = await axios({
        method: 'POST',
        url: this.apiUrl,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        data: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanNumber,
          type: 'reaction',
          reaction: {
            message_id: messageId,
            emoji: emoji
          }
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('⚠️  Error sending reaction:', error.response?.data);
    }
  }
}

module.exports = WhatsAppBusinessService;
