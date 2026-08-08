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
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Thiếu GROQ_API_KEY trên Vercel." });
    }

    const { messages, prompt, temperature } = req.body || {};
    
    // ĐÂY LÀ ĐOẠN PROMPT ÉP JSON - TƯỚC QUYỀN GIAO TIẾP CỦA AI
    const systemInstruction = `Bạn là một API xử lý ngôn ngữ. BẠN BẮT BUỘC PHẢI TRẢ VỀ DỮ LIỆU DƯỚI DẠNG ĐỊNH DẠNG JSON. KHÔNG ĐƯỢC CHÈN BẤT KỲ CÂU GIAO TIẾP NÀO VÀO (ví dụ: cấm nói "Tôi hiểu rồi", "Ví dụ là...").

CẤU TRÚC JSON DUY NHẤT ĐƯỢC CHẤP NHẬN:
{
  "data": [
    {
      "zh": "Chữ Hán (Pinyin trong ngoặc tròn)",
      "vi": "Nghĩa tiếng Việt"
    }
  ]
}

QUY TẮC NHẬP LIỆU VÀO JSON:
1. NẾU người dùng bảo "không cần tiếng Việt", hãy để trống giá trị "vi": "".
2. NẾU người dùng muốn câu ví dụ, hãy cho thẳng câu ví dụ bằng tiếng Trung vào "zh" và nghĩa vào "vi", không được kèm theo lời mào đầu.
3. Giá trị "zh" CHỈ được chứa chữ Hán và Pinyin, tuyệt đối không có tiếng Việt bên trong.`;

    let finalMessages = [{ role: "system", content: systemInstruction }];

    if (messages && Array.isArray(messages) && messages.length > 0) {
      finalMessages = finalMessages.concat(messages);
    } else if (prompt) {
      finalMessages.push({ role: "user", content: prompt });
    }

    const groqUrl = "https://api.groq.com/openai/v1/chat/completions";

    const textResponse = await fetch(groqUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: finalMessages,
        temperature: temperature || 0.6,
        // Ép Groq phải trả về chuẩn JSON
        response_format: { type: "json_object" },
        stream: false
      })
    });

    const textData = await textResponse.json();
    if (!textResponse.ok) {
      throw new Error(textData?.error?.message || "Lỗi gọi API Groq.");
    }

    const rawContent = textData?.choices?.[0]?.message?.content?.trim();
    if (!rawContent) {
      throw new Error("Groq không trả về nội dung.");
    }

    // Bóc tách JSON an toàn
    let parsedJson;
    try {
      // Đôi khi AI bọc JSON trong markdown ```json ... ```
      const cleanedJson = rawContent.replace(/```json/gi, '').replace(/```/gi, '').trim();
      parsedJson = JSON.parse(cleanedJson);
    } catch (e) {
      console.error("Lỗi parse JSON:", rawContent);
      throw new Error("AI không trả về đúng định dạng JSON.");
    }

    const dataArray = parsedJson.data || [];
    let aiText = "";
    let audioBase64 = "";
    const audioBuffers = [];

    // Tự động xây dựng lại Text cho Frontend và Xử lý Audio siêu chuẩn
    for (const item of dataArray) {
      const zhText = item.zh || "";
      const viText = item.vi || "";

      if (!zhText) continue;

      // 1. Dựng chữ hiển thị ra Web (luôn chuẩn form)
      aiText += `${zhText}\n`;
      if (viText) {
        aiText += `${viText}\n`;
      }
      aiText += `\n`; // Cách một dòng giữa các mục

      // 2. Kéo Audio Tiếng Trung
      let cleanZh = zhText.replace(/[*_#]/g, "").replace(/\(.*?\)/g, "").trim();
      if (cleanZh) {
        const zhUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=gtx&tl=zh-CN&q=${encodeURIComponent(cleanZh)}`;
        try {
          const zhRes = await fetch(zhUrl, { headers: { "User-Agent": "Mozilla/5.0" }});
          if (zhRes.ok) audioBuffers.push(Buffer.from(await zhRes.arrayBuffer()));
        } catch(e) {}
      }

      // 3. Kéo Audio Tiếng Việt (chỉ kéo khi có dữ liệu)
      let cleanVi = viText.replace(/[*_#]/g, "").trim();
      if (cleanVi) {
        const viUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=gtx&tl=vi&q=${encodeURIComponent(cleanVi)}`;
        try {
          const viRes = await fetch(viUrl, { headers: { "User-Agent": "Mozilla/5.0" }});
          if (viRes.ok) audioBuffers.push(Buffer.from(await viRes.arrayBuffer()));
        } catch(e) {}
      }
    }

    if (audioBuffers.length > 0) {
      const combinedBuffer = Buffer.concat(audioBuffers);
      audioBase64 = combinedBuffer.toString('base64');
    }

    return res.status(200).json({
      result: aiText.trim(),          
      audioBase64: audioBase64 
    });

  } catch (error) {
    console.error("Lỗi Server:", error);
    return res.status(500).json({ error: error.message });
  }
};