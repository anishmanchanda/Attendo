# 🚀 Deploying to Render - Step by Step

## ✅ Pre-Deployment Checklist

Before deploying, make sure you have:

- [x] Created WhatsApp Business API app on Meta
- [ ] Got your Phone Number ID from Meta dashboard
- [ ] Got your Access Token from Meta dashboard
- [ ] Verified your MongoDB Atlas is accessible
- [ ] Tested OpenAI API key locally

---

## 📋 Step 1: Update Environment Variables

1. **Get your WhatsApp Phone Number ID:**
   - Go to: https://developers.facebook.com/apps
   - Select your app
   - Go to WhatsApp → API Setup
   - Copy the "Phone number ID" (e.g., `123456789012345`)

2. **Update your `.env` file locally** (for testing):
   ```bash
   WHATSAPP_PHONE_NUMBER_ID=123456789012345  # Replace with your actual ID
   ```

---

## 🔧 Step 2: Test Locally

Before deploying, test the production app locally:

```bash
# Install dependencies
npm install

# Start the production app
npm start

# In another terminal, use ngrok to expose the webhook
ngrok http 3000
```

You should see:
```
🚀 Server running on port 3000
📱 WhatsApp webhook: http://localhost:3000/webhook
```

---

## 🌐 Step 3: Deploy to Render

### A. Push to GitHub

```bash
# Make sure .env is in .gitignore (already done!)
# Commit all changes
git add .
git commit -m "Production ready for Render deployment"
git push origin main
```

### B. Create Render Account

1. Go to: https://render.com
2. Click "Get Started"
3. Sign up with GitHub
4. Authorize Render to access your repos

### C. Create New Web Service

1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub repository: `attendance-chatbot`
3. Configure the service:

   ```
   Name: attendance-chatbot
   Region: Oregon (US West)
   Branch: main
   Root Directory: (leave blank)
   Runtime: Node
   Build Command: npm install
   Start Command: npm start
   Instance Type: Free
   ```

4. Click **"Advanced"** to add environment variables

### D. Add Environment Variables

Click **"Add Environment Variable"** for each:

```
MONGODB_URI
= mongodb+srv://anishmanchanda2006_db_user:X8EwT2Lam7B7s8q1@attendance.scoesba.mongodb.net/?retryWrites=true&w=majority&appName=attendance


WHATSAPP_PHONE_NUMBER_ID
= your_phone_number_id_here

WHATSAPP_ACCESS_TOKEN
= EAAaOo0nTe5gBP5GlGD3XnYpDQmJk80oR7M8LNqgYtaoVUu7DvcuR4cyOEa2xWyZBeZCyu88dyv6bucMTi1SJZCZAJSizN22ZCl3Sbe1vSzCH8Wh2yJroAevZBg97bluo527RZAbAMJAANgbJne1EJtgicSJpKrvw5YOoMiVinqnOf6N6hAiYo4UtprIflC3H3CaW8CZAkUGOBKzCgkrb4iGezM4p6QW9D8ES0qE8loEZCYmQvYuaA7fbSKVAZAJQKk4JQC28eAOXDAyvSBJlAHzILr

WEBHOOK_VERIFY_TOKEN
= my_super_secret_token_12345

NODE_ENV
= production
```

5. Click **"Create Web Service"**

---

## ⏱️ Step 4: Wait for Deployment

Render will:
1. Clone your repo ✅
2. Install dependencies ✅
3. Run `npm start` ✅
4. Expose a public URL ✅

**Build time:** ~2-3 minutes

You'll see logs like:
```
==> Cloning from GitHub...
==> Running 'npm install'...
==> Running 'npm start'...
==> Your service is live at https://attendance-chatbot.onrender.com
```

---

## 🔗 Step 5: Configure WhatsApp Webhook

1. **Copy your Render URL:**
   ```
   https://attendance-chatbot.onrender.com
   ```

2. **Go to Meta Developer Dashboard:**
   - https://developers.facebook.com/apps
   - Select your app
   - Go to **WhatsApp** → **Configuration**

3. **Click "Edit" next to Webhook:**
   ```
   Callback URL: https://attendance-chatbot.onrender.com/webhook
   Verify Token: my_super_secret_token_12345
   ```

4. **Click "Verify and Save"**

   You should see: ✅ **"Webhook verified successfully"**

5. **Subscribe to webhook fields:**
   - Click **"Manage"**
   - Check **"messages"**
   - Click **"Save"**

---

## 🧪 Step 6: Test Your Bot!

### Send a test message:

1. **Add your phone as a test recipient** (if not already done):
   - In Meta dashboard: WhatsApp → API Setup
   - Click "Add phone number"
   - Enter your number and verify

2. **Send a WhatsApp message** to your test number:
   ```
   Hi
   ```

3. **You should receive a reply:**
   ```
   👋 Welcome to the Attendance Bot!
   
   I can help you track your class attendance automatically.
   
   📋 To get started:
   1. Tell me your name and roll number
   2. Upload your class schedule (photo or PDF)
   3. Start reporting attendance!
   
   💡 Example:
   "My name is John Doe and my roll number is 12345"
   
   What's your name and roll number?
   ```

### Check Render logs:

In Render dashboard, click "Logs" to see:
```
📨 Webhook data received
📩 New message received:
   From: 1234567890
   Type: text
📤 Sending message to 1234567890
✅ Message sent successfully
```

---

## 🔄 Step 7: Keep Free Tier Awake (Optional)

Render free tier sleeps after 15 minutes. To keep it awake:

### Setup UptimeRobot:

1. Go to: https://uptimerobot.com
2. Sign up (free)
3. Click **"+ Add New Monitor"**
4. Configure:
   ```
   Monitor Type: HTTP(s)
   Friendly Name: Attendance Bot
   URL: https://attendance-chatbot.onrender.com/health
   Monitoring Interval: 5 minutes
   ```
5. Click **"Create Monitor"**

Now your bot will stay awake 24/7! 🎉

---

## 📊 Monitoring Your Bot

### Check Health Status:

Visit: `https://attendance-chatbot.onrender.com/health`

You'll see:
```json
{
  "status": "ok",
  "uptime": 12345,
  "timestamp": "2025-10-23T...",
  "services": {
    "mongodb": "connected",
    "whatsapp": "initialized",
    "ai": "initialized"
  }
}
```

### View Logs in Render:

1. Go to Render dashboard
2. Click on your service
3. Click **"Logs"** tab
4. See real-time logs of all messages

---

## 🚨 Troubleshooting

### Problem: Webhook verification fails

**Solution:**
1. Check `WEBHOOK_VERIFY_TOKEN` matches in:
   - Render environment variables
   - Meta webhook configuration
2. Make sure URL ends with `/webhook`
3. Check Render logs for errors

### Problem: Bot doesn't respond to messages

**Solution:**
1. Check Render logs for errors
2. Verify `WHATSAPP_PHONE_NUMBER_ID` is correct
3. Check WhatsApp webhook subscription includes "messages"
4. Test with: `https://your-app.onrender.com/health`

### Problem: MongoDB connection fails

**Solution:**
1. Check `MONGODB_URI` is correct
2. Verify MongoDB Atlas allows connections from any IP (0.0.0.0/0)
3. Check MongoDB Atlas cluster is running

### Problem: OpenAI API errors

**Solution:**
1. Verify `OPENAI_API_KEY` is valid
2. Check you have credits in OpenAI account
3. Visit: https://platform.openai.com/account/usage

---

## 🎉 Success!

Your WhatsApp bot is now live and deployed!

### What's working:
- ✅ 24/7 uptime (with UptimeRobot)
- ✅ Automatic message handling
- ✅ AI-powered conversations
- ✅ Attendance tracking
- ✅ Auto-deploy from GitHub

### Next steps:
1. Share your bot with friends for testing
2. Monitor usage in Render dashboard
3. Add more features
4. Upgrade to paid plan if needed ($7/mo for always-on)

---

## 💡 Pro Tips

1. **Update your bot:**
   ```bash
   git add .
   git commit -m "New feature"
   git push origin main
   # Render auto-deploys in ~2 minutes!
   ```

2. **View real-time logs:**
   ```bash
   # Install Render CLI
   npm install -g @render/cli
   
   # View logs
   render logs -f
   ```

3. **Custom domain (optional):**
   - In Render: Settings → Custom Domain
   - Add your domain
   - Update DNS records
   - Bot URL becomes: `https://bot.yourdomain.com`

---

## 📞 Support

If you need help:
1. Check Render logs first
2. Test with `/health` endpoint
3. Verify all environment variables
4. Check Meta webhook events

---

## 🎯 Deployment Checklist

- [ ] All files committed to GitHub
- [ ] .env NOT committed (in .gitignore)
- [ ] Render service created
- [ ] All environment variables added
- [ ] Service deployed successfully
- [ ] Webhook verified in Meta
- [ ] Test message sent and received
- [ ] UptimeRobot monitor created
- [ ] Health check responding

**All done? Congratulations! 🎉**
