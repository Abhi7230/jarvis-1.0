export function getLandingHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jarvis - AI Job Search Agent</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
    }
    .hero {
      text-align: center;
      padding: 60px 20px 40px;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    }
    .hero h1 {
      font-size: 3rem;
      font-weight: 800;
      background: linear-gradient(135deg, #00d2ff, #7b2ff7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 12px;
    }
    .hero .subtitle {
      font-size: 1.25rem;
      color: #a0a0b0;
      max-width: 600px;
      margin: 0 auto 30px;
      line-height: 1.6;
    }
    .hero .badge {
      display: inline-block;
      background: rgba(123, 47, 247, 0.2);
      border: 1px solid rgba(123, 47, 247, 0.4);
      color: #b388ff;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 0.85rem;
      margin-bottom: 20px;
    }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .feature {
      background: #141420;
      border: 1px solid #2a2a3a;
      border-radius: 12px;
      padding: 24px;
      transition: border-color 0.3s;
    }
    .feature:hover { border-color: #7b2ff7; }
    .feature .icon { font-size: 1.8rem; margin-bottom: 10px; }
    .feature h3 { font-size: 1.1rem; margin-bottom: 8px; color: #fff; }
    .feature p { font-size: 0.9rem; color: #888; line-height: 1.5; }

    .pricing {
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
      text-align: center;
    }
    .pricing h2 {
      font-size: 2rem;
      margin-bottom: 10px;
      color: #fff;
    }
    .pricing .desc {
      color: #888;
      margin-bottom: 30px;
    }
    .plans {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 24px;
    }
    .plan {
      background: #141420;
      border: 2px solid #2a2a3a;
      border-radius: 16px;
      padding: 32px 24px;
      text-align: left;
      position: relative;
    }
    .plan.popular {
      border-color: #7b2ff7;
      box-shadow: 0 0 30px rgba(123, 47, 247, 0.15);
    }
    .plan .tag {
      position: absolute;
      top: -12px;
      right: 20px;
      background: linear-gradient(135deg, #7b2ff7, #00d2ff);
      color: #fff;
      padding: 4px 14px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .plan h3 { font-size: 1.3rem; color: #fff; margin-bottom: 4px; }
    .plan .price {
      font-size: 2.5rem;
      font-weight: 800;
      color: #fff;
      margin: 12px 0;
    }
    .plan .price span { font-size: 1rem; color: #888; font-weight: 400; }
    .plan .price .free-tag { color: #4caf50; }
    .plan ul {
      list-style: none;
      margin: 20px 0;
    }
    .plan ul li {
      padding: 6px 0;
      font-size: 0.95rem;
      color: #bbb;
    }
    .plan ul li::before {
      content: '\\2713';
      color: #4caf50;
      font-weight: bold;
      margin-right: 10px;
    }
    .plan ul li.disabled {
      color: #555;
    }
    .plan ul li.disabled::before {
      content: '\\2717';
      color: #555;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 10px;
      font-size: 1.05rem;
      font-weight: 700;
      cursor: pointer;
      text-align: center;
      text-decoration: none;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .btn-free {
      background: #1e1e30;
      color: #00d2ff;
      border: 2px solid #00d2ff;
    }
    .btn-premium {
      background: linear-gradient(135deg, #7b2ff7, #00d2ff);
      color: #fff;
    }

    .how {
      max-width: 700px;
      margin: 0 auto;
      padding: 40px 20px 60px;
      text-align: center;
    }
    .how h2 { font-size: 2rem; color: #fff; margin-bottom: 30px; }
    .steps {
      display: flex;
      flex-direction: column;
      gap: 16px;
      text-align: left;
    }
    .step {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      background: #141420;
      border: 1px solid #2a2a3a;
      border-radius: 12px;
      padding: 20px;
    }
    .step-num {
      background: linear-gradient(135deg, #7b2ff7, #00d2ff);
      color: #fff;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      flex-shrink: 0;
    }
    .step-text h4 { color: #fff; margin-bottom: 4px; }
    .step-text p { color: #888; font-size: 0.9rem; }

    .footer {
      text-align: center;
      padding: 30px;
      color: #555;
      font-size: 0.85rem;
      border-top: 1px solid #1a1a2a;
    }
    .footer a { color: #7b2ff7; text-decoration: none; }

    @media (max-width: 600px) {
      .hero h1 { font-size: 2rem; }
      .plan .price { font-size: 2rem; }
    }
  </style>
</head>
<body>

  <div class="hero">
    <div class="badge">Powered by AI</div>
    <h1>Jarvis</h1>
    <p class="subtitle">
      Your AI job search assistant. Finds recruiters, sends personalized messages,
      tracks outreach, and follows up automatically — all from Telegram.
    </p>
  </div>

  <div class="features">
    <div class="feature">
      <div class="icon">&#x1F50D;</div>
      <h3>Find Recruiters</h3>
      <p>Search LinkedIn for recruiters at any company. AI finds the right people for your role.</p>
    </div>
    <div class="feature">
      <div class="icon">&#x1F4AC;</div>
      <h3>Auto Message</h3>
      <p>Send personalized messages to recruiters. AI crafts messages tailored to each person.</p>
    </div>
    <div class="feature">
      <div class="icon">&#x1F4CA;</div>
      <h3>Track Everything</h3>
      <p>Dashboard of who you've contacted, who replied, and who needs a follow-up.</p>
    </div>
    <div class="feature">
      <div class="icon">&#x1F504;</div>
      <h3>Auto Follow-Up</h3>
      <p>Jarvis reminds you to follow up with recruiters who haven't replied in 3 days.</p>
    </div>
    <div class="feature">
      <div class="icon">&#x1F4BC;</div>
      <h3>Job Tracker</h3>
      <p>Save jobs, update statuses, and keep all your applications organized.</p>
    </div>
    <div class="feature">
      <div class="icon">&#x26A1;</div>
      <h3>100% Free AI</h3>
      <p>Uses Groq + Gemini (free LLMs). No API costs. Runs 24/7 on the cloud.</p>
    </div>
  </div>

  <div class="pricing">
    <h2>Simple Pricing</h2>
    <p class="desc">Start free. Upgrade when you're ready to land that dream job.</p>

    <div class="plans">
      <div class="plan">
        <h3>Free</h3>
        <div class="price"><span class="free-tag">$0</span> <span>forever</span></div>
        <ul>
          <li>5 LinkedIn searches/day</li>
          <li>AI-powered chat</li>
          <li>Job tracker</li>
          <li>Outreach stats</li>
          <li class="disabled">LinkedIn messaging</li>
          <li class="disabled">Auto follow-ups</li>
          <li class="disabled">Gmail integration</li>
          <li class="disabled">Resume editing</li>
        </ul>
        <a href="https://t.me/Jarvis7230_bot" target="_blank" class="btn btn-free">
          Start Free on Telegram
        </a>
      </div>

      <div class="plan popular">
        <div class="tag">Most Popular</div>
        <h3>Premium</h3>
        <div class="price">&#8377;499 <span>/month</span></div>
        <ul>
          <li>50 LinkedIn searches/day</li>
          <li>50 LinkedIn messages/day</li>
          <li>AI-powered chat</li>
          <li>Job tracker</li>
          <li>Outreach stats</li>
          <li>Auto follow-up reminders</li>
          <li>Gmail integration</li>
          <li>Resume editing (Overleaf)</li>
        </ul>
        <a href="https://t.me/Jarvis7230_bot?start=premium" target="_blank" class="btn btn-premium">
          Get Premium
        </a>
      </div>
    </div>
  </div>

  <div class="how">
    <h2>Get Started in 30 Seconds</h2>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text">
          <h4>Open Telegram</h4>
          <p>Search for <strong>@Jarvis7230_bot</strong> or click the button above.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text">
          <h4>Press /start</h4>
          <p>Jarvis creates your account automatically. No sign-up forms.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text">
          <h4>Connect LinkedIn</h4>
          <p>Use /login_linkedin to securely connect your LinkedIn (encrypted).</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-text">
          <h4>Start Searching</h4>
          <p>Type "Search for recruiters at Google" and Jarvis does the rest.</p>
        </div>
      </div>
    </div>
  </div>

  <div class="footer">
    Built by <a href="https://github.com/Abhi7230" target="_blank">Abhi</a> |
    Powered by Groq, Gemini & Claude
  </div>

</body>
</html>`;
}
