# ✅ Deployment Checklist

Copy this checklist and check off items as you complete them!

## Pre-Deployment

- [ ] **Get WhatsApp Phone Number ID**
  - Go to: https://developers.facebook.com/apps
  - Select your app
  - WhatsApp → API Setup
  - Copy "Phone number ID"
  - Update in `.env` file

- [ ] **Generate Permanent Access Token** (Optional but recommended)
  - Meta Dashboard → WhatsApp → Configuration
  - System User Token → Generate
  - Replace token in `.env`

- [ ] **Test Locally**
  ```bash
  npm start
  # Should see: ✅ Server running successfully
  ```

- [ ] **Verify MongoDB Connection**
  - Check MongoDB Atlas is running
  - Verify connection string in `.env`
  - Test: `npm start` should show "✅ Connected to MongoDB"

- [ ] **Verify OpenAI API Key**
  - Check: https://platform.openai.com/account/api-keys
  - Ensure key is active and has credits

---

## Git & GitHub

- [ ] **Check Git Status**
  ```bash
  git status
  # .env should NOT be listed (it's in .gitignore)
  ```

- [ ] **Commit Changes**
  ```bash
  git add .
  git commit -m "Production ready - WhatsApp Business API"
  ```

- [ ] **Push to GitHub**
  ```bash
  git push origin main
  ```

---

## Render Deployment

- [ ] **Create Render Account**
  - Go to: https://render.com
  - Sign up with GitHub

- [ ] **Create Web Service**
  - Click "New +" → "Web Service"
  - Connect `attendance-chatbot` repo
  
- [ ] **Configure Service**
  ```
  Name: attendance-chatbot
  Branch: main  
  Build: npm install
  Start: npm start
  Plan: Free
  ```

- [ ] **Add Environment Variables**
  Click "Advanced" and add each variable from your `.env`:
  - [ ] MONGODB_URI
  - [ ] OPENAI_API_KEY
  - [ ] WHATSAPP_PHONE_NUMBER_ID
  - [ ] WHATSAPP_ACCESS_TOKEN
  - [ ] WEBHOOK_VERIFY_TOKEN
  - [ ] NODE_ENV=production

- [ ] **Deploy!**
  - Click "Create Web Service"
  - Wait 2-3 minutes for build

- [ ] **Copy Deployment URL**
  - Save: `https://attendance-chatbot.onrender.com`

---

## WhatsApp Configuration

- [ ] **Configure Webhook**
  - Meta Dashboard → WhatsApp → Configuration
  - Click "Edit" next to Webhook
  
- [ ] **Add Webhook URL**
  ```
  Callback URL: https://attendance-chatbot.onrender.com/webhook
  Verify Token: my_super_secret_token_12345
  ```

- [ ] **Verify Webhook**
  - Click "Verify and Save"
  - Should see: ✅ "Webhook verified successfully"

- [ ] **Subscribe to Messages**
  - Click "Manage"
  - Check "messages" field
  - Click "Save"

- [ ] **Add Test Phone Number** (if not already done)
  - WhatsApp → API Setup
  - Add phone number
  - Verify with WhatsApp code

---

## Testing

- [ ] **Check Deployment Health**
  ```bash
  curl https://attendance-chatbot.onrender.com/health
  # Should return: {"status":"ok"}
  ```

- [ ] **Send Test Message**
  - WhatsApp → Your test number
  - Send: "Hi"
  
- [ ] **Verify Bot Response**
  - Should receive: "👋 Welcome to the Attendance Bot!"

- [ ] **Check Render Logs**
  - Render Dashboard → Logs
  - Should see: "📩 New message received"

- [ ] **Test Registration**
  - Send: "My name is John and my roll number is 12345"
  - Verify bot responds with confirmation

---

## Keep Awake (Optional - Free Tier)

- [ ] **Setup UptimeRobot**
  - Go to: https://uptimerobot.com
  - Sign up (free)
  
- [ ] **Add Monitor**
  ```
  Type: HTTP(s)
  URL: https://attendance-chatbot.onrender.com/health
  Interval: 5 minutes
  ```

- [ ] **Verify Monitor Active**
  - Check dashboard shows "Up"
  
---

## Post-Deployment

- [ ] **Share Bot Number**
  - Give test number to friends/users
  
- [ ] **Monitor Usage**
  - Render Dashboard → Metrics
  - OpenAI Dashboard → Usage
  - MongoDB Atlas → Metrics

- [ ] **Document Bot Commands**
  - Create user guide (optional)
  - List available commands

- [ ] **Set Up Alerts** (Optional)
  - Render → Notifications
  - Email alerts for downtime

---

## Future Enhancements (Optional)

- [ ] **Custom Domain**
  - Render → Custom Domain
  - Configure DNS

- [ ] **Upgrade to Paid Plan** (if needed)
  - $7/month for always-on
  - Better performance

- [ ] **Add More Features**
  - Image schedule processing
  - PDF support
  - Analytics dashboard

- [ ] **Apply for WhatsApp Production Access**
  - Meta Business Verification
  - Production phone number

---

## Troubleshooting

If something doesn't work:

1. **Check Render Logs**
   - Look for error messages
   
2. **Verify Environment Variables**
   - All variables set correctly
   
3. **Test Health Endpoint**
   - `curl https://your-app.onrender.com/health`
   
4. **Check WhatsApp Webhook**
   - Subscription active
   - Verify token matches

5. **MongoDB Connection**
   - IP whitelist includes 0.0.0.0/0
   - Connection string correct

6. **OpenAI API**
   - Key valid
   - Has credits

---

## Success Criteria

✅ All items checked above
✅ Bot responds to WhatsApp messages
✅ Health endpoint returns 200 OK
✅ No errors in Render logs
✅ MongoDB connected
✅ OpenAI API working

---

## 🎉 Congratulations!

Once all items are checked, your WhatsApp bot is live and fully deployed!

**Deployed?** Update this file:
- [ ] ✅ **DEPLOYED ON:** [Date]
- [ ] ✅ **DEPLOYMENT URL:** https://attendance-chatbot.onrender.com
- [ ] ✅ **STATUS:** Live ✅ / Issues ⚠️

---

**Need Help?** Check:
- `QUICKSTART.md` - Quick 5-min guide
- `DEPLOYMENT.md` - Detailed step-by-step
- `SUMMARY.md` - Overview of changes

**Questions?** Review Render logs and DEPLOYMENT.md troubleshooting section.

---

Happy Deploying! 🚀
