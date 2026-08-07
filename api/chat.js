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

    // 2. TÁCH CÂU THÔNG MINH (GIỮ NGUYÊN DẤU CÂU VÀ NGỮ ĐIỆU)
    let audioBase64 = "";
    try {
      const segments = [];
      let currentSegment = "";
      let currentLang = "vi"; // Mặc định khởi đầu bằng tiếng Việt

      for (let i = 0; i < aiText.length; i++) {
        const char = aiText[i];
        const isChinese = /[\u4e00-\u9fff]/.test(char);
        // Nhận diện mọi loại dấu câu (kể cả dấu Trung Quốc) và khoảng trắng
        const isPunctuationOrSpace = /[.,!?()\[\]{}\s。，！？；：“”‘’（）]/i.test(char);

        if (isChinese) {
          if (currentLang !== "zh-CN" && currentSegment.trim().length > 0) {
            segments.push({ text: currentSegment, lang: currentLang });
            currentSegment = "";
          }
          currentLang = "zh-CN";
          currentSegment += char;
        } else if (isPunctuationOrSpace) {
          // Gắn dính dấu câu/khoảng trắng vào phân đoạn hiện tại để giữ nhịp nghỉ
          currentSegment += char; 
        } else {
          // Là chữ cái Latin/Tiếng Việt
          if (currentLang !== "vi" && currentSegment.trim().length > 0) {
            segments.push({ text: currentSegment, lang: currentLang });
            currentSegment = "";
          }
          currentLang = "vi";
          currentSegment += char;
        }
      }

      // Đẩy đoạn cuối cùng vào mảng
      if (currentSegment.trim().length > 0) {
        segments.push({ text: currentSegment, lang: currentLang });
      }

      const audioBuffers = [];

      // Vòng lặp lấy MP3 cho từng khúc đã được băm chuẩn xác
      for (let seg of segments) {
        // Lọc an toàn: Chỉ gọi Google TTS nếu đoạn đó thực sự có chứa chữ cái/số
        // Tránh lỗi gửi đoạn chỉ toàn dấu phẩy hoặc khoảng trắng lên Server
        if (/[a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\u4e00-\u9fff]/.test(seg.text)) {
          const safeTextToRead = encodeURIComponent(seg.text.substring(0, 200));
          const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${seg.lang}&q=${safeTextToRead}`;
          
          const audioResponse = await fetch(ttsUrl);
          if (audioResponse.ok) {
            const arrayBuffer = await audioResponse.arrayBuffer();
            audioBuffers.push(Buffer.from(arrayBuffer));
          }
        }
      }

      // Hàn nối tất cả các MP3 lại thành 1 luồng âm thanh liên tục
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