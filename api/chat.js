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

    const finalPrompt = prompt + "\n\n(LƯU Ý BẮT BUỘC TỪ HỆ THỐNG: Nếu có viết Pinyin, BẮT BUỘC phải đặt toàn bộ Pinyin vào trong ngoặc vuông [...]. Ví dụ: 欢迎你！ [Huānyíng nǐ!] (Chào mừng em!). Tuyệt đối không dùng định dạng khác để tránh lỗi hệ thống âm thanh.)";

    // 1. Gọi Gemini 3.5-flash
    const model = process.env.GEMINI_TEXT_MODEL || "gemini-3.5-flash"; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const textResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
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

    // 2. DỌN DẸP VĂN BẢN TRƯỚC KHI TẠO AUDIO
    let textForAudio = aiText;
    textForAudio = textForAudio.replace(/[*_#]/g, "");
    textForAudio = textForAudio.replace(/\[.*?\]/g, "");
    textForAudio = textForAudio.replace(/\([A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s!?.,]+[-–—:]\s*/gi, "(");

    // 3. TÁCH CÂU VÀ LẤY MP3 SONG SONG (TỐI ƯU HÓA TỐC ĐỘ)
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

      // Xử lý ném TẤT CẢ các luồng request lên Google cùng lúc (Parallel Fetching)
      const fetchPromises = segments.map(async (seg, index) => {
        if (/[a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\u4e00-\u9fff]/.test(seg.text)) {
          const safeTextToRead = encodeURIComponent(seg.text.substring(0, 200));
          const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${seg.lang}&q=${safeTextToRead}`;
          
          try {
            const audioResponse = await fetch(ttsUrl);
            if (audioResponse.ok) {
              const arrayBuffer = await audioResponse.arrayBuffer();
              return { index, buffer: Buffer.from(arrayBuffer) };
            }
          } catch (e) {
             console.warn("Lỗi tải MP3 cho segment:", e);
          }
        }
        return { index, buffer: null };
      });

      // Chờ tất cả request hoàn thành
      const fetchedResults = await Promise.all(fetchPromises);
      
      // Sắp xếp lại âm thanh theo đúng thứ tự mảng ban đầu
      fetchedResults.sort((a, b) => a.index - b.index);
      
      const audioBuffers = fetchedResults
        .filter(res => res.buffer !== null)
        .map(res => res.buffer);

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