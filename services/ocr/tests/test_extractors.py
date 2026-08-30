from app.extractors import OcrLine, classify_document, extract_id_card, extract_medical_invoice


def line(text: str, score: float = 0.98) -> OcrLine:
    return OcrLine(text=text, score=score, box=[])


def test_extract_id_card() -> None:
    lines = [
        line("姓名 张三"),
        line("性别 男 民族 汉"),
        line("出生 1990年1月2日"),
        line("住址 上海市浦东新区测试路1号"),
        line("公民身份号码 11010519491231002X"),
    ]
    document_type, _ = classify_document(lines)
    result = extract_id_card(lines)

    assert document_type == "id_card"
    assert result["fields"]["name"]["value"] == "张三"
    assert result["fields"]["birthDate"]["value"] == "1990-01-02"
    assert result["fields"]["idNumber"]["value"] == "11010519491231002X"
    assert result["warnings"] == []


def test_extract_medical_invoice() -> None:
    lines = [
        line("上海市医疗门诊收费票据"),
        line("票据号码：12345678"),
        line("患者姓名：李四"),
        line("医疗机构名称：测试人民医院"),
        line("医疗费总额：￥1234.56"),
        line("医保统筹支付：800.00"),
        line("个人现金支付：434.56"),
    ]
    document_type, _ = classify_document(lines)
    result = extract_medical_invoice(lines)

    assert document_type == "medical_invoice"
    assert result["fields"]["invoiceNumber"]["value"] == "12345678"
    assert result["fields"]["totalAmount"]["value"] == "1234.56"
    assert result["fields"]["cashPayment"]["value"] == "434.56"
