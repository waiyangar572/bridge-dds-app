import unittest

try:
    from .events import AndEvent, CardHoldingEvent, HcpEvent, NotEvent, OrEvent, SuitLengthEvent
except ImportError:
    from events import AndEvent, CardHoldingEvent, HcpEvent, NotEvent, OrEvent, SuitLengthEvent


class EventAstTest(unittest.TestCase):
    def test_builds_requested_target_event(self) -> None:
        event_a = HcpEvent(player="N", min_hcp=15, max_hcp=17)
        event_b = SuitLengthEvent(player="N", suit="S", min_length=5, max_length=13)
        event_c = CardHoldingEvent(player="N", card="SA")
        event_x = event_a & event_b & event_c

        event_y1 = SuitLengthEvent(player="E", suit="S", min_length=3, max_length=3)
        event_y2 = SuitLengthEvent(player="W", suit="S", min_length=3, max_length=3)
        event_y = event_y1 & event_y2

        target_z = event_x & ~event_y

        self.assertEqual(event_x, AndEvent((event_a, event_b, event_c)))
        self.assertEqual(event_y, AndEvent((event_y1, event_y2)))
        self.assertEqual(target_z, AndEvent((event_a, event_b, event_c, NotEvent(event_y))))

    def test_or_builds_or_event(self) -> None:
        north_15_17 = HcpEvent(player="N", min_hcp=15, max_hcp=17)
        north_18_19 = HcpEvent(player="N", min_hcp=18, max_hcp=19)

        self.assertEqual(north_15_17 | north_18_19, OrEvent((north_15_17, north_18_19)))

    def test_validates_atomic_events(self) -> None:
        with self.assertRaises(ValueError):
            SuitLengthEvent(player="N", suit="S", min_length=7, max_length=6)
        with self.assertRaises(ValueError):
            HcpEvent(player="X", min_hcp=0, max_hcp=10)
        with self.assertRaises(ValueError):
            CardHoldingEvent(player="N", card="S1")


if __name__ == "__main__":
    unittest.main()
