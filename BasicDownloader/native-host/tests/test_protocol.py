import io,struct,unittest
from stream_host.protocol import MAX_MESSAGE_BYTES,ProtocolError,encode_frame,read_frame
class ProtocolTests(unittest.TestCase):
    def test_round_trip_and_utf8_byte_length(self):
        value={"text":"한글"};frame=encode_frame(value);self.assertEqual(struct.unpack("<I",frame[:4])[0],len(frame[4:]));self.assertEqual(read_frame(io.BytesIO(frame)),value)
    def test_bad_prefix_and_oversize(self):
        with self.assertRaises(ProtocolError):read_frame(io.BytesIO(b"\x01"))
        with self.assertRaises(ProtocolError):read_frame(io.BytesIO(struct.pack("<I",MAX_MESSAGE_BYTES+1)))

