module.exports = async function (req, res) {
  // CORS config
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Chỉ chấp nhận phương thức POST" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Thiếu GEMINI_API_KEY trên Vercel." });
    }

    const { prompt, temperature } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Thiếu nội dung prompt." });
    }

    // 1. Gọi Gemini 3.5-flash
    const model = process.env.GEMINI_TEXT_MODEL || "gemini-3.5-flash"; 
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

    // 2. TÁCH CÂU VÀ LẤY AUDIO ĐÚNG GIỌNG (TRUNG RIÊNG, VIỆT RIÊNG)
    let audioBase64 = "";
    try {
      // Băm câu trả lời thành mảng: Chữ Hán nằm riêng, chữ Latin/Việt nằm riêng
      const chunks = aiText.split(/([\u4e00-\u9fff]+)/g).filter(c => c.trim().length > 0);
      const audioBuffers = [];

      for (let chunk of chunks) {
        // Kiểm tra xem đoạn này có chứa chữ Hán hay không
        const isChinese = /[\u4e00-\u9fff]/.test(chunk);
        
        // Cú pháp thần thánh: Có Hán -> giọng Trung (zh-CN), Không Hán -> giọng Việt (vi)
        const tl = isChinese ? "zh-CN" : "vi"; 
        
        const safeTextToRead = encodeURIComponent(chunk.substring(0, 200));
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${safeTextToRead}`;
        
        const audioResponse = await fetch(ttsUrl);
        if (audioResponse.ok) {
          const arrayBuffer = await audioResponse.arrayBuffer();
          audioBuffers.push(Buffer.from(arrayBuffer));
        }
      }

      // MP3 hỗ trợ ghép nối nhị phân trực tiếp. Gộp tất cả lại thành 1 luồng âm thanh duy nhất!
      if (audioBuffers.length > 0) {
        const combinedBuffer = Buffer.concat(audioBuffers);
        audioBase64 = combinedBuffer.toString('base64');
      }

    } catch (ttsError) {
      console.warn("Lỗi TTS:", ttsError);
    }

    return res.status(200).json({
      result: aiText,
      audioBase64: audioBase64
    });

  } catch (error) {
    console.error("Lỗi Server:", error);
    return res.status(500).json({
      error: error.message || "Lỗi server không xác định."
    });
  }
};