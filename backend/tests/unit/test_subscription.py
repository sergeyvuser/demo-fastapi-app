from shared.config import SubscriptionConfig, SymbolConfig


def test_names_and_membership_come_from_one_list() -> None:
    subscription = SubscriptionConfig(
        symbols=[SymbolConfig(name="BTCUSDT", precision=2)]
    )

    assert subscription.names == ["BTCUSDT"]
    assert "BTCUSDT" in subscription
    assert "DOGEUSDT" not in subscription
