def camel_case_to_snake_case(input_string: str) -> str:
    """
    "SomeSDK" -> "some_sdk",
    "RServoDrive" -> "r_servo_drive",
    "SDKDemo" -> "sdk_demo",

    :param input_string:
    :return: string with snake_case
    """
    chars = []
    for c_idx, char in enumerate(input_string):
        if c_idx and char.isupper():
            nxt_idx = c_idx + 1
            flag = nxt_idx >= len(input_string) or input_string[nxt_idx].isupper()
            prev_char = input_string[nxt_idx - 1]
            if prev_char.isupper() and flag:
                pass
            else:
                chars.append("_")
        chars.append(char.lower())
    return "".join(chars)
