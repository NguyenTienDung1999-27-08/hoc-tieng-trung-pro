export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Thiếu GEMINI_API_KEY trong Environment Variables." });
    }

    const { prompt, temperature } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Thiếu nội dung prompt." });
    }

    // 1. GỌI GEMINI ĐỂ LẤY VĂN BẢN TRẢ LỜI
    const model = process.env.GEMINI_TEXT_MODEL || "gemini-1.5-flash"; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const textResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: temperature || 0.6,
          topP: 0.9,
          maxOutputTokens: 1000
        }
      })
    });

    const textData = await textResponse.json();
    if (!textResponse.ok) {
      throw new Error(textData?.error?.message || "Lỗi gọi AI Gemini.");
    }

    const aiText = textData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!aiText) {
      throw new Error("Gemini không trả về nội dung.");
    }

    // 2. GỌI GOOGLE TRANSLATE CLOUD ĐỂ LẤY FILE ÂM THANH
    let audioBase64 = "";
    try {
      const safeTextToRead = encodeURIComponent(aiText.substring(0, 200));
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-CN&q=${safeTextToRead}`;
      
      const audioResponse = await fetch(ttsUrl);
      if (audioResponse.ok) {
        const arrayBuffer = await audioResponse.arrayBuffer();
        audioBase64 = Buffer.from(arrayBuffer).toString('base64');
      }
    } catch (ttsError) {
      console.warn("Lỗi không lấy được âm thanh từ Google Cloud:", ttsError);
    }

    // 3. TRẢ VỀ CẢ CHỮ VÀ ÂM THANH CHO TRÌNH DUYỆT
    return res.status(200).json({
      result: aiText,
      audioBase64: audioBase64
    });

  } catch (error) {
    console.error("Lỗi Vercel API:", error);
    return res.status(500).json({
      error: error.message || "Lỗi server không xác định."
    });
  }
}