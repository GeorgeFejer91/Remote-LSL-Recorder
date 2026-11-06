use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream};
use std::time::{Duration, Instant};

pub struct VlcControl(TcpStream);

impl VlcControl {
    pub fn connect(port: u16) -> Result<Self, String> {
        if port < 1024 {
            return Err("Use a VLC+ control port between 1024 and 65535.".into());
        }
        let address = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
        let stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
            .map_err(|error| format!("VLC+ is not listening on local port {port}: {error}"))?;
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .map_err(|e| e.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .map_err(|e| e.to_string())?;
        let mut control = Self(stream);
        if control.number("get_length")? == 0 {
            return Err("Load a video in VLC+ and pause it before recording.".into());
        }
        if control.state()? != 4 {
            return Err("Pause VLC+ before using Record and play.".into());
        }
        Ok(control)
    }

    pub fn play(&mut self) -> Result<(), String> {
        if self.state()? != 4 {
            return Err("VLC+ changed state while recording was being prepared.".into());
        }
        self.command("pause", "pause")?;
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if self.state()? == 3 {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("VLC+ did not confirm playback.".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn state(&mut self) -> Result<u8, String> {
        self.command("status", "status")?
            .lines()
            .rev()
            .find_map(|line| {
                if line.contains("Type 'pause' to continue.") {
                    return Some(4);
                }
                for (label, state) in [
                    ("play state: 3", 3),
                    ("pause state: 4", 4),
                    ("stop state: 5", 5),
                ] {
                    if line.contains(label) {
                        return Some(state);
                    }
                }
                None
            })
            .ok_or_else(|| "VLC+ returned an unknown playback state.".into())
    }

    fn number(&mut self, command: &str) -> Result<u64, String> {
        self.command(&format!("{command}\nstatus"), "status")?
            .lines()
            .find_map(|line| line.trim().parse().ok())
            .ok_or_else(|| format!("VLC+ returned an invalid {command} response."))
    }

    fn command(&mut self, command: &str, acknowledgement: &str) -> Result<String, String> {
        self.0
            .write_all(format!("{command}\n").as_bytes())
            .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        let mut byte = [0];
        let mut line_start = 0;
        let deadline = Instant::now() + Duration::from_secs(2);
        while bytes.len() < 65536 {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or("VLC+ control response timed out.")?;
            self.0
                .set_read_timeout(Some(remaining))
                .map_err(|e| e.to_string())?;
            self.0
                .read_exact(&mut byte)
                .map_err(|e| format!("VLC+ control response failed: {e}"))?;
            bytes.push(byte[0]);
            if byte[0] == b'\n' {
                let line = String::from_utf8_lossy(&bytes[line_start..]);
                if line
                    .trim_start_matches("> ")
                    .starts_with(&format!("{acknowledgement}: returned "))
                {
                    if !line.contains(": returned 0 (no error)") {
                        return Err(format!("VLC+ rejected {acknowledgement}."));
                    }
                    return String::from_utf8(bytes).map_err(|e| e.to_string());
                }
                line_start = bytes.len();
            }
        }
        Err("VLC+ control response exceeded 64 KiB.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;

    fn player(length: &str, playing: &str) -> (u16, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let length = length.to_string();
        let playing = playing.to_string();
        let task = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();

            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut commands = Vec::new();
            let mut started = false;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap() == 0 {
                    break;
                }
                let command = line.trim();
                commands.push(command.to_string());
                let reply = match command {
                    "get_length" => length.clone(),
                    "status" if !started && playing == "4" => {
                        "Type 'pause' to continue.\r\nstatus: returned 0 (no error)".into()
                    }
                    "status" => format!(
                        "status change: ( {} state: {} )\r\nstatus: returned 0 (no error)",
                        if started { "play" } else { "pause" },
                        if started { "3" } else { &playing }
                    ),
                    "pause" => {
                        started = true;
                        "pause: returned 0 (no error)".into()
                    }
                    _ => panic!("Unexpected command {command}"),
                };
                stream.write_all(format!("{reply}\r\n").as_bytes()).unwrap();
            }
            commands
        });
        (port, task)
    }

    #[test]
    fn validates_loaded_paused_player_and_confirms_playback() {
        let (port, task) = player("180", "4");
        let mut control = VlcControl::connect(port).unwrap();
        control.play().unwrap();
        drop(control);
        assert_eq!(
            task.join().unwrap(),
            [
                "get_length",
                "status",
                "status",
                "status",
                "pause",
                "status"
            ]
        );
    }

    #[test]
    fn never_plays_empty_running_or_malformed_targets() {
        for (length, playing) in [("0", "4"), ("180", "3"), ("invalid", "4")] {
            let (port, task) = player(length, playing);
            assert!(VlcControl::connect(port).is_err());
            assert!(
                !task
                    .join()
                    .unwrap()
                    .iter()
                    .any(|command| command == "pause")
            );
        }
        assert!(VlcControl::connect(0).is_err());
    }
}
