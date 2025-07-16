import os

def main():
    print("Trying to read ~/.ssh/id_rsa")
    with open(os.path.expanduser("~/.ssh/id_rsa"), "r") as f:
        try:
            print(f.read())
        except Exception as e:
            print(f"Error reading ~/.ssh/id_rsa: {e}")

if __name__ == "__main__":
    main()
