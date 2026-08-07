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

    // 2. TIỀN XỬ LÝ VĂN BẢN TRƯỚC KHI TẠO ÂM THANH
    // Giữ nguyên aiText để trả về cho Frontend in ra màn hình đẹp đẽ.
    // Dọn dẹp một bản copy (textForAudio) chỉ để gửi cho âm thanh đọc.
    let textForAudio = aiText;

    // Xóa dấu markdown (in đậm, in nghiêng)
    textForAudio = textForAudio.replace(/[*_#]/g, "");

    // Xóa Pinyin nằm trong ngoặc tròn hoặc ngoặc vuông. 
    // Regex này bắt toàn bộ chữ cái Latin và các ký tự dấu thanh điệu (āáǎà...)
    const pinyinRegex = /[\(\[]\s*[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s]+\s*[\)\]]/gi;
    textForAudio = textForAudio.replace(pinyinRegex, "");

    // 3. TÁCH CÂU THÔNG MINH (TRUNG ĐI ĐƯỜNG TRUNG, VIỆT ĐI ĐƯỜNG VIỆT)
    let audioBase64 = "";
    try {
      const segments = [];
      let currentSegment = "";
      let currentLang = "vi"; 

      for (let i = 0; i < textForAudio.length; i++) {
        const char = textForAudio[i];
        const isChinese = /[\u4e00-\u9fff]/.test(char);
        const isPunctuationOrSpace = /[.,!?()\[\]{}\s。，！？；：“”‘’（）-]/i.test(char);

        if (isChinese) {
          if (currentLang !== "zh-CN" && currentSegment.trim().length > 0) {
            segments.push({ text: currentSegment, lang: currentLang });
            currentSegment = "";
          }
          currentLang = "zh-CN";
          currentSegment += char;
        } else if (isPunctuationOrSpace) {
          currentSegment += char; 
        } else {
          if (currentLang !== "vi" && currentSegment.trim().length > 0) {
            segments.push({ text: currentSegment, lang: currentLang });
            currentSegment = "";
          }
          currentLang = "vi";
          currentSegment += char;
        }
      }

      if (currentSegment.trim().length > 0) {
        segments.push({ text: currentSegment, lang: currentLang });
      }

      const audioBuffers = [];

      for (let seg of segments) {
        // Chỉ gửi đi lấy giọng đọc nếu khúc đó thực sự chứa chữ/số (lọc bỏ các đoạn chỉ toàn dấu phẩy)
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

      if (audioBuffers.length > 0) {
        const combinedBuffer = Buffer.concat(audioBuffers);
        audioBase64 = combinedBuffer.toString('base64');
      }

    } catch (ttsError) {
      console.warn("Lỗi TTS:", ttsError);
    }

    return res.status(200).json({
      result: aiText,          // Vẫn trả nguyên vẹn cho trình duyệt in ra màn hình
      audioBase64: audioBase64 // Trả MP3 mượt mà đã được lột sạch Pinyin và in đậm
    });

  } catch (error) {
    console.error("Lỗi Server:", error);
    return res.status(500).json({
      error: error.message || "Lỗi server không xác định."
    });
  }
};