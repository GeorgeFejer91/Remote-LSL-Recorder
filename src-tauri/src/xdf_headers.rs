pub struct StreamIdentity<'a> {
    pub name: &'a str,
    pub source_id: &'a str,
    pub hostname: &'a str,
}

pub fn ready(bytes: &[u8], expected: &[StreamIdentity<'_>]) -> bool {
    if !bytes.starts_with(b"XDF:") || expected.is_empty() {
        return false;
    }
    let mut headers = Vec::new();
    let mut remaining = &bytes[4..];
    while let Some(&width) = remaining.first() {
        let width = usize::from(width);
        if ![1, 4, 8].contains(&width) || remaining.len() < width + 1 {
            break;
        }
        let mut encoded = [0; 8];
        encoded[..width].copy_from_slice(&remaining[1..=width]);
        let Ok(length) = usize::try_from(u64::from_le_bytes(encoded)) else {
            break;
        };
        remaining = &remaining[width + 1..];
        if length < 2 || remaining.len() < length {
            break;
        }
        let chunk = &remaining[..length];
        if chunk[..2] == [2, 0]
            && chunk.len() >= 6
            && let Ok(xml) = std::str::from_utf8(&chunk[6..])
        {
            headers.push(xml);
        }
        remaining = &remaining[length..];
    }
    expected.iter().all(|stream| {
        headers.iter().any(|xml| {
            field(xml, "name", stream.name)
                && field(xml, "hostname", stream.hostname)
                && (stream.source_id.is_empty() || field(xml, "source_id", stream.source_id))
        })
    })
}

fn field(xml: &str, name: &str, value: &str) -> bool {
    let escaped = value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;");
    xml.contains(&format!("<{name}>{escaped}</{name}>"))
        || (value.is_empty() && xml.contains(&format!("<{name} />")))
        || (value.is_empty() && xml.contains(&format!("<{name}/>")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(tag: u16, xml: &str) -> Vec<u8> {
        let mut result = vec![4];
        result.extend_from_slice(&((6 + xml.len()) as u32).to_le_bytes());
        result.extend_from_slice(&tag.to_le_bytes());
        result.extend_from_slice(&1u32.to_le_bytes());
        result.extend_from_slice(xml.as_bytes());
        result
    }

    #[test]
    fn waits_for_complete_headers_from_the_exact_host_not_sample_text() {
        let expected = [StreamIdentity {
            name: "VLC",
            source_id: "same-pid",
            hostname: "local",
        }];
        let xml = "<info><name>VLC</name><source_id>same-pid</source_id><hostname>local</hostname></info>";
        let mut bytes = b"XDF:".to_vec();
        bytes.extend(chunk(3, xml));
        bytes.extend(chunk(2, &xml.replace("local", "other")));
        assert!(!ready(&bytes, &expected));
        let header = chunk(2, xml);
        bytes.extend(&header[..header.len() - 1]);
        assert!(!ready(&bytes, &expected));
        bytes.push(header[header.len() - 1]);
        assert!(ready(&bytes, &expected));
        assert!(!ready(
            b"XDF:\x08\xff\xff\xff\xff\xff\xff\xff\xff",
            &expected
        ));
    }
}
