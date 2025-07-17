// use std::sync::Mutex;

// pub struct PortState(pub Mutex<u16>);

pub fn get_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}
