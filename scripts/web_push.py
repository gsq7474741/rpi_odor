from pywebpush import webpush


def push_to_iphone(data: str):
    subscription_info = {
        "endpoint": "https://web.push.apple.com/QCtzcPsKQHjDEx20YIFH1VUYkXEtSVckinQ_gFDVv9EtsVOD0qQ-RfL0BgPgyeoYjRDkUgOtr3uAEljNKi4xEve7cuYcwu-nfiHAOHiU0h9dyMZZZkfZb9cWYO_vpvwx21UU_3UzFZGc0rp2LM_smSxh8n93UpXxyar7lOtm59k",
        "keys": {"p256dh": "BNGgczEsJHlcPEDM9tqBZtu3xed0IxvYVDtzIlsPep7rSEX92NPorwgV-pxJGGHOhrUYwTHfnxml973g7nqTRI4",
                 "auth": "zZAGkVZVvbO0wjL2EuZp7A"}}
    claims = {"aud": "https://web.push.apple.com",
              "sub": "mailto:gsq7474741@icloud.com"}

    vapidPublicKey = "BN5klMscVbp0ny9QqmIh2q5hSV7yT8UtrFyuxq-KGi9PdZQoghf7C4-yityv9keIVLEzpTGUonGF0uffbNR5xyo"
    vapidPrivateKey = "OnzuXW6ncsEm63nD5VRBpUDrvaUdDQnZmq7dpfLsESs"

    webpush(subscription_info,
            data,
            vapid_private_key=vapidPrivateKey,
            vapid_claims=claims)


if __name__ == '__main__':
    push_to_iphone('hello')